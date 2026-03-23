import { getHydratedData } from '@/services/bootstrap';
import { dataFreshness } from '@/services/data-freshness';
import { getRpcBaseUrl } from '@/services/rpc-client';
import {
  MilitaryServiceClient,
  type ListForceCompositionsResponse,
  type ForceCompositionEntry as RpcForceCompositionEntry,
  type ForceCompositionCluster as RpcForceCompositionCluster,
} from '@/generated/client/worldmonitor/military/v1/service_client';
import type {
  ForceCompositionCluster,
  ForceCompositionEntry,
  ForceCompositionMeta,
  ForceCompositionSide,
} from '@/types';

const client = new MilitaryServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) });

export interface ForceCompositionFetchFilters {
  side?: 'all' | ForceCompositionSide;
  echelon?: 'all' | string;
}

interface CachedResult {
  entries: ForceCompositionEntry[];
  clusters: ForceCompositionCluster[];
  totalInView: number;
  truncated: boolean;
  datasetVersion: string;
  updatedAt: string;
  availableEchelons: string[];
  cacheKey: string;
}

const quantize = (value: number, step: number) => Math.round(value / step) * step;

function getBboxGridStep(zoom: number): number {
  if (zoom < 5) return 5;
  if (zoom <= 7) return 1;
  return 0.5;
}

function quantizeBbox(swLat: number, swLon: number, neLat: number, neLon: number, zoom: number): string {
  const step = getBboxGridStep(zoom);
  return [
    quantize(swLat, step),
    quantize(swLon, step),
    quantize(neLat, step),
    quantize(neLon, step),
  ].join(':');
}

function normalizeOptionalCoordinate(latitude: number, longitude: number): { latitude: number | null; longitude: number | null } {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { latitude: null, longitude: null };
  }
  if (latitude === 0 && longitude === 0) {
    return { latitude: null, longitude: null };
  }
  return { latitude, longitude };
}

function entryToApp(entry: RpcForceCompositionEntry): ForceCompositionEntry {
  const hq = normalizeOptionalCoordinate(entry.hqLatitude, entry.hqLongitude);
  const deployment = normalizeOptionalCoordinate(entry.deploymentLatitude, entry.deploymentLongitude);
  return {
    id: entry.id,
    name: entry.name,
    side: (entry.side || 'blue') as ForceCompositionSide,
    branch: entry.branch,
    unitType: entry.unitType,
    echelon: entry.echelon,
    personnelEstimate: entry.personnelEstimate,
    parentId: entry.parentId || undefined,
    parentName: entry.parentName || undefined,
    childCount: entry.childCount,
    displayLatitude: entry.displayLatitude,
    displayLongitude: entry.displayLongitude,
    displayPositionType: entry.displayPositionType === 'hq' ? 'hq' : 'deployment',
    hqLatitude: hq.latitude,
    hqLongitude: hq.longitude,
    deploymentLatitude: deployment.latitude,
    deploymentLongitude: deployment.longitude,
    countryIso2: entry.countryIso2 || undefined,
    notes: entry.notes || undefined,
    aliases: entry.aliases?.length ? entry.aliases : undefined,
    status: entry.status || undefined,
    readiness: entry.readiness || undefined,
    equipmentSummary: entry.equipmentSummary?.length ? entry.equipmentSummary : undefined,
    sourceRefs: entry.sourceRefs?.length ? entry.sourceRefs : undefined,
  };
}

function clusterToApp(cluster: RpcForceCompositionCluster): ForceCompositionCluster {
  return {
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    count: cluster.count,
    side: (cluster.side || 'blue') as ForceCompositionSide,
    dominantEchelon: cluster.dominantEchelon,
    expansionZoom: cluster.expansionZoom,
  };
}

function isForceCompositionMeta(value: unknown): value is ForceCompositionMeta {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ForceCompositionMeta>;
  return typeof candidate.datasetVersion === 'string'
    && typeof candidate.updatedAt === 'string'
    && typeof candidate.source === 'string'
    && typeof candidate.unitCount === 'number'
    && Array.isArray(candidate.availableEchelons)
    && Array.isArray(candidate.sides);
}

let knownMeta: ForceCompositionMeta | null = null;
let lastResult: CachedResult | null = null;
let pendingCacheKey = '';
let pendingFetch: Promise<CachedResult | null> | null = null;

function getKnownMeta(): ForceCompositionMeta | null {
  if (knownMeta) return knownMeta;
  const hydrated = getHydratedData('forceCompositionMeta');
  if (isForceCompositionMeta(hydrated)) {
    knownMeta = hydrated;
  }
  return knownMeta;
}

function updateKnownMeta(
  response: Pick<ListForceCompositionsResponse, 'datasetVersion' | 'updatedAt'>,
  fallbackEchelons: string[],
): ForceCompositionMeta | null {
  const existing = getKnownMeta();
  if (existing) {
    knownMeta = {
      ...existing,
      datasetVersion: response.datasetVersion || existing.datasetVersion,
      updatedAt: response.updatedAt || existing.updatedAt,
      availableEchelons: existing.availableEchelons.length > 0 ? existing.availableEchelons : fallbackEchelons,
    };
    return knownMeta;
  }

  if (fallbackEchelons.length === 0 && !response.datasetVersion && !response.updatedAt) {
    return null;
  }

  knownMeta = {
    datasetVersion: response.datasetVersion || '',
    updatedAt: response.updatedAt || '',
    source: '',
    unitCount: 0,
    availableEchelons: fallbackEchelons,
    sides: ['red', 'blue'],
  };
  return knownMeta;
}

export function getForceCompositionMeta(): ForceCompositionMeta | null {
  return getKnownMeta();
}

export function getAvailableForceCompositionEchelons(): string[] {
  return getKnownMeta()?.availableEchelons ?? lastResult?.availableEchelons ?? [];
}

export function clearForceCompositionCache(): void {
  lastResult = null;
  pendingCacheKey = '';
}

export async function fetchForceCompositions(
  swLat: number,
  swLon: number,
  neLat: number,
  neLon: number,
  zoom: number,
  filters: ForceCompositionFetchFilters = {},
): Promise<CachedResult | null> {
  const quantizedBbox = quantizeBbox(swLat, swLon, neLat, neLon, zoom);
  const floorZoom = Math.floor(zoom);
  const sideKey = filters.side && filters.side !== 'all' ? filters.side : '';
  const echelonKey = filters.echelon && filters.echelon !== 'all' ? filters.echelon.toLowerCase() : '';
  const cacheKey = `${quantizedBbox}:${floorZoom}:${sideKey}:${echelonKey}`;

  if (lastResult && lastResult.cacheKey === cacheKey) {
    return lastResult;
  }

  if (pendingFetch && pendingCacheKey === cacheKey) {
    return pendingFetch;
  }

  pendingCacheKey = cacheKey;
  pendingFetch = (async () => {
    try {
      const response = await client.listForceCompositions({
        swLat,
        swLon,
        neLat,
        neLon,
        zoom: floorZoom,
        side: sideKey ? [sideKey] : [],
        echelon: echelonKey ? [echelonKey] : [],
      });

      const entries = response.entries.map(entryToApp);
      const clusters = response.clusters.map(clusterToApp);
      const fallbackEchelons = [...new Set(entries.map((entry) => entry.echelon))];
      const meta = updateKnownMeta(response, fallbackEchelons);
      const result: CachedResult = {
        entries,
        clusters,
        totalInView: response.totalInView,
        truncated: response.truncated,
        datasetVersion: response.datasetVersion,
        updatedAt: response.updatedAt,
        availableEchelons: meta?.availableEchelons ?? fallbackEchelons,
        cacheKey,
      };
      lastResult = result;
      dataFreshness.recordUpdate('force_compositions', response.totalInView);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dataFreshness.recordError('force_compositions', message);
      console.error('[force-compositions] fetch error', error);
      return lastResult;
    } finally {
      pendingFetch = null;
      pendingCacheKey = '';
    }
  })();

  return pendingFetch;
}
