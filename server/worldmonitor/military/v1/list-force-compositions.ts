import type {
  ServerContext,
  ListForceCompositionsRequest,
  ListForceCompositionsResponse,
  ForceCompositionEntry,
  ForceCompositionCluster,
} from '../../../../src/generated/server/worldmonitor/military/v1/service_server';

import { cachedFetchJson } from '../../../_shared/redis';
import { markNoCacheResponse } from '../../../_shared/response-headers';

import {
  FORCE_COMPOSITION_ECHELON_ORDER,
  FORCE_COMPOSITION_META,
  FORCE_COMPOSITION_SIDES,
  FORCE_COMPOSITION_UNITS,
  ensureForceCompositionMetadataSynced,
  type PreparedForceCompositionUnit,
} from './_force-compositions-data';

const MAX_RESULTS = 1500;

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function getBboxGridStep(zoom: number): number {
  if (zoom < 5) return 5;
  if (zoom <= 7) return 1;
  return 0.5;
}

function getClusterCellSize(zoom: number): number {
  if (zoom < 4) return 6;
  if (zoom < 6) return 2;
  if (zoom < 8) return 0.75;
  return 0;
}

function getExpansionZoom(cellSize: number): number {
  if (cellSize >= 6) return 5;
  if (cellSize >= 2) return 6;
  if (cellSize >= 0.75) return 8;
  return 10;
}

function normalizeFilter(values: string[], validSet: Set<string>): string[] | null {
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (normalized.some((value) => !validSet.has(value))) return null;
  return normalized;
}

function normalizeEchelonFilter(values: string[]): string[] | null {
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (normalized.some((value) => !FORCE_COMPOSITION_ECHELON_ORDER.has(value) && !FORCE_COMPOSITION_META.availableEchelons.includes(value))) {
    return null;
  }
  return normalized;
}

function matchesBbox(
  entry: PreparedForceCompositionUnit,
  swLat: number,
  swLon: number,
  neLat: number,
  neLon: number,
): boolean {
  const lat = entry.displayLatitude;
  const lon = entry.displayLongitude;
  const minLat = Math.min(swLat, neLat);
  const maxLat = Math.max(swLat, neLat);
  if (lat < minLat || lat > maxLat) return false;
  if (swLon <= neLon) {
    return lon >= swLon && lon <= neLon;
  }
  return lon >= swLon || lon <= neLon;
}

function toEntry(entry: PreparedForceCompositionUnit): ForceCompositionEntry {
  return {
    id: entry.id,
    name: entry.name,
    side: entry.side,
    branch: entry.branch,
    unitType: entry.unitType,
    echelon: entry.echelon,
    personnelEstimate: entry.personnelEstimate,
    parentId: entry.parentId,
    parentName: entry.parentName,
    childCount: entry.childCount,
    displayLatitude: entry.displayLatitude,
    displayLongitude: entry.displayLongitude,
    displayPositionType: entry.displayPositionType,
    hqLatitude: entry.hqLatitude,
    hqLongitude: entry.hqLongitude,
    deploymentLatitude: entry.deploymentLatitude,
    deploymentLongitude: entry.deploymentLongitude,
    countryIso2: entry.countryIso2,
    notes: entry.notes,
    aliases: entry.aliases,
    status: entry.status,
    readiness: entry.readiness,
    equipmentSummary: entry.equipmentSummary,
    sourceRefs: entry.sourceRefs,
  };
}

function dominantEchelon(units: PreparedForceCompositionUnit[]): string {
  const counts = new Map<string, number>();
  for (const unit of units) {
    counts.set(unit.echelon, (counts.get(unit.echelon) ?? 0) + 1);
  }

  let winner = units[0]?.echelon ?? '';
  let winnerCount = -1;
  for (const [echelon, count] of counts) {
    const winnerRank = FORCE_COMPOSITION_ECHELON_ORDER.get(winner) ?? Number.MAX_SAFE_INTEGER;
    const echelonRank = FORCE_COMPOSITION_ECHELON_ORDER.get(echelon) ?? Number.MAX_SAFE_INTEGER;
    if (count > winnerCount || (count === winnerCount && echelonRank < winnerRank)) {
      winner = echelon;
      winnerCount = count;
    }
  }
  return winner;
}

function applyClusterOffsets(
  clusters: Array<ForceCompositionCluster & { cellKey: string; cellSize: number }>,
): ForceCompositionCluster[] {
  const grouped = new Map<string, Array<ForceCompositionCluster & { cellKey: string; cellSize: number }>>();
  for (const cluster of clusters) {
    const siblings = grouped.get(cluster.cellKey) ?? [];
    siblings.push(cluster);
    grouped.set(cluster.cellKey, siblings);
  }

  const result: ForceCompositionCluster[] = [];
  for (const siblings of grouped.values()) {
    if (siblings.length < 2) {
      result.push(siblings[0]!);
      continue;
    }

    for (const cluster of siblings) {
      const offset = Math.max(0.08, cluster.cellSize * 0.12);
      result.push({
        latitude: cluster.latitude + (cluster.side === 'red' ? offset * 0.25 : -offset * 0.25),
        longitude: cluster.longitude + (cluster.side === 'red' ? offset : -offset),
        count: cluster.count,
        side: cluster.side,
        dominantEchelon: cluster.dominantEchelon,
        expansionZoom: cluster.expansionZoom,
      });
    }
  }
  return result;
}

function clusterForceCompositions(
  units: PreparedForceCompositionUnit[],
  zoom: number,
): { entries: ForceCompositionEntry[]; clusters: ForceCompositionCluster[] } {
  const cellSize = getClusterCellSize(zoom);
  if (cellSize === 0) {
    return {
      entries: units.map(toEntry),
      clusters: [],
    };
  }

  const cells = new Map<string, PreparedForceCompositionUnit[]>();
  for (const unit of units) {
    const latKey = Math.floor(unit.displayLatitude / cellSize);
    const lonKey = Math.floor(unit.displayLongitude / cellSize);
    const cellKey = `${latKey}:${lonKey}:${unit.side}`;
    const bucket = cells.get(cellKey) ?? [];
    bucket.push(unit);
    cells.set(cellKey, bucket);
  }

  const rawClusters: Array<ForceCompositionCluster & { cellKey: string; cellSize: number }> = [];
  for (const [cellKey, group] of cells) {
    const baseCellKey = cellKey.split(':').slice(0, 2).join(':');
    let latSum = 0;
    let lonSum = 0;
    for (const unit of group) {
      latSum += unit.displayLatitude;
      lonSum += unit.displayLongitude;
    }
    rawClusters.push({
      cellKey: baseCellKey,
      cellSize,
      latitude: latSum / group.length,
      longitude: lonSum / group.length,
      count: group.length,
      side: group[0]!.side,
      dominantEchelon: dominantEchelon(group),
      expansionZoom: getExpansionZoom(cellSize),
    });
  }

  return {
    entries: [],
    clusters: applyClusterOffsets(rawClusters),
  };
}

export async function listForceCompositions(
  ctx: ServerContext,
  req: ListForceCompositionsRequest,
): Promise<ListForceCompositionsResponse> {
  try {
    void ensureForceCompositionMetadataSynced();

    const empty: ListForceCompositionsResponse = {
      entries: [],
      clusters: [],
      totalInView: 0,
      truncated: false,
      datasetVersion: FORCE_COMPOSITION_META.datasetVersion,
      updatedAt: FORCE_COMPOSITION_META.updatedAt,
    };

    if (!req.neLat && !req.neLon && !req.swLat && !req.swLon) return empty;

    const swLat = Math.max(-90, Math.min(90, req.swLat));
    const neLat = Math.max(-90, Math.min(90, req.neLat));
    const swLon = Math.max(-180, Math.min(180, req.swLon));
    const neLon = Math.max(-180, Math.min(180, req.neLon));
    const zoom = Math.max(0, Math.min(22, req.zoom || 3));

    const sideFilter = normalizeFilter(parseStringArray(req.side), FORCE_COMPOSITION_SIDES as Set<string>);
    const echelonFilter = normalizeEchelonFilter(parseStringArray(req.echelon));
    if (!sideFilter || !echelonFilter) return empty;

    const gridStep = getBboxGridStep(zoom);
    const quantizedBbox = [
      quantize(swLat, gridStep),
      quantize(swLon, gridStep),
      quantize(neLat, gridStep),
      quantize(neLon, gridStep),
    ].join(':');
    const cacheKey = [
      'military:force-compositions:v1',
      quantizedBbox,
      Math.floor(zoom),
      sideFilter.join(','),
      echelonFilter.join(','),
      FORCE_COMPOSITION_META.datasetVersion,
    ].join(':');

    const result = await cachedFetchJson<ListForceCompositionsResponse>(
      cacheKey,
      3600,
      async () => {
        const filtered = FORCE_COMPOSITION_UNITS.filter((unit) => {
          if (sideFilter.length > 0 && !sideFilter.includes(unit.side)) return false;
          if (echelonFilter.length > 0 && !echelonFilter.includes(unit.echelon)) return false;
          return matchesBbox(unit, swLat, swLon, neLat, neLon);
        });

        const totalInView = filtered.length;
        const truncated = totalInView > MAX_RESULTS;
        const limited = filtered
          .slice(0, MAX_RESULTS)
          .sort((left, right) => {
            const leftRank = FORCE_COMPOSITION_ECHELON_ORDER.get(left.echelon) ?? Number.MAX_SAFE_INTEGER;
            const rightRank = FORCE_COMPOSITION_ECHELON_ORDER.get(right.echelon) ?? Number.MAX_SAFE_INTEGER;
            if (leftRank !== rightRank) return leftRank - rightRank;
            return left.name.localeCompare(right.name);
          });

        const clustered = clusterForceCompositions(limited, zoom);

        return {
          entries: clustered.entries,
          clusters: clustered.clusters,
          totalInView,
          truncated,
          datasetVersion: FORCE_COMPOSITION_META.datasetVersion,
          updatedAt: FORCE_COMPOSITION_META.updatedAt,
        };
      },
    );

    return result ?? empty;
  } catch (error) {
    console.error('[force-compositions] list failed', error);
    markNoCacheResponse(ctx.request);
    return {
      entries: [],
      clusters: [],
      totalInView: 0,
      truncated: false,
      datasetVersion: FORCE_COMPOSITION_META.datasetVersion,
      updatedAt: FORCE_COMPOSITION_META.updatedAt,
    };
  }
}
