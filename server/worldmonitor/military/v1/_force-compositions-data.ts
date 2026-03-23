import forceCompositionsDataset from '../../../../shared/military-force-compositions.json';

import { setCachedJson } from '../../../_shared/redis';

export type ForceCompositionSide = 'red' | 'blue';
export type ForceCompositionDisplayPositionType = 'deployment' | 'hq';

interface RawCoordinate {
  latitude: number;
  longitude: number;
}

interface RawForceCompositionUnit {
  id: string;
  name: string;
  side: ForceCompositionSide;
  branch: string;
  unitType: string;
  echelon: string;
  personnelEstimate: number;
  parentId: string;
  hq: RawCoordinate | null;
  deployment: RawCoordinate | null;
  countryIso2?: string;
  notes?: string;
  aliases?: string[];
  status?: string;
  readiness?: string;
  equipmentSummary?: string[];
  sourceRefs?: string[];
}

interface RawForceCompositionDataset {
  datasetVersion: string;
  updatedAt: string;
  source: string;
  units: RawForceCompositionUnit[];
}

export interface PreparedForceCompositionUnit {
  id: string;
  name: string;
  side: ForceCompositionSide;
  branch: string;
  unitType: string;
  echelon: string;
  personnelEstimate: number;
  parentId: string;
  parentName: string;
  childCount: number;
  displayLatitude: number;
  displayLongitude: number;
  displayPositionType: ForceCompositionDisplayPositionType;
  hqLatitude: number;
  hqLongitude: number;
  deploymentLatitude: number;
  deploymentLongitude: number;
  countryIso2: string;
  notes: string;
  aliases: string[];
  status: string;
  readiness: string;
  equipmentSummary: string[];
  sourceRefs: string[];
}

export interface ForceCompositionDatasetMeta {
  datasetVersion: string;
  updatedAt: string;
  source: string;
  unitCount: number;
  availableEchelons: string[];
  sides: ForceCompositionSide[];
}

export const FORCE_COMPOSITION_BOOTSTRAP_META_KEY = 'military:force-compositions:meta:v1';
export const FORCE_COMPOSITION_SEED_META_KEY = 'seed-meta:military:force-compositions';

const VALID_SIDES = new Set<ForceCompositionSide>(['red', 'blue']);
const ECHELON_ORDER = [
  'army_group',
  'front',
  'theater',
  'corps',
  'division',
  'brigade',
  'regiment',
  'battalion',
  'company',
  'platoon',
];
const META_TTL_SECONDS = 7 * 24 * 60 * 60;

const echelonSortOrder = new Map<string, number>(ECHELON_ORDER.map((value, index) => [value, index]));

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCoordinate(value: unknown): value is RawCoordinate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RawCoordinate>;
  return isFiniteNumber(candidate.latitude) && isFiniteNumber(candidate.longitude);
}

function normalizeString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Force composition dataset field "${fieldName}" must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Force composition dataset field "${fieldName}" cannot be empty`);
  }
  return trimmed;
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalStringArray(value: unknown, fieldName: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Force composition dataset field "${fieldName}" must be a string array`);
  }
  return value
    .map((item, index) => normalizeString(item, `${fieldName}[${index}]`))
    .filter(Boolean);
}

function normalizeSide(value: unknown, unitId: string): ForceCompositionSide {
  const normalized = normalizeString(value, `units[${unitId}].side`).toLowerCase();
  if (!VALID_SIDES.has(normalized as ForceCompositionSide)) {
    throw new Error(`Force composition unit "${unitId}" has unsupported side "${normalized}"`);
  }
  return normalized as ForceCompositionSide;
}

function normalizeCoordinate(
  value: unknown,
  unitId: string,
  fieldName: 'hq' | 'deployment',
): RawCoordinate | null {
  if (value == null) return null;
  if (!isCoordinate(value)) {
    throw new Error(`Force composition unit "${unitId}" has invalid ${fieldName} coordinates`);
  }
  return {
    latitude: Math.max(-90, Math.min(90, value.latitude)),
    longitude: Math.max(-180, Math.min(180, value.longitude)),
  };
}

function normalizeUnit(value: unknown, index: number): RawForceCompositionUnit {
  if (!value || typeof value !== 'object') {
    throw new Error(`Force composition unit at index ${index} must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const id = normalizeString(candidate.id, `units[${index}].id`);
  const name = normalizeString(candidate.name, `units[${index}].name`);
  const echelon = normalizeString(candidate.echelon, `units[${index}].echelon`).toLowerCase();
  const hq = normalizeCoordinate(candidate.hq, id, 'hq');
  const deployment = normalizeCoordinate(candidate.deployment, id, 'deployment');
  if (!hq && !deployment) {
    throw new Error(`Force composition unit "${id}" must define at least one position`);
  }
  if (!isFiniteNumber(candidate.personnelEstimate)) {
    throw new Error(`Force composition unit "${id}" must define a numeric personnelEstimate`);
  }

  return {
    id,
    name,
    side: normalizeSide(candidate.side, id),
    branch: normalizeString(candidate.branch, `units[${id}].branch`),
    unitType: normalizeString(candidate.unitType, `units[${id}].unitType`),
    echelon,
    personnelEstimate: Math.max(0, Math.round(candidate.personnelEstimate)),
    parentId: normalizeOptionalString(candidate.parentId),
    hq,
    deployment,
    countryIso2: normalizeOptionalString(candidate.countryIso2).toUpperCase(),
    notes: normalizeOptionalString(candidate.notes),
    aliases: normalizeOptionalStringArray(candidate.aliases, `units[${id}].aliases`),
    status: normalizeOptionalString(candidate.status),
    readiness: normalizeOptionalString(candidate.readiness),
    equipmentSummary: normalizeOptionalStringArray(candidate.equipmentSummary, `units[${id}].equipmentSummary`),
    sourceRefs: normalizeOptionalStringArray(candidate.sourceRefs, `units[${id}].sourceRefs`),
  };
}

function sortEchelons(values: Iterable<string>): string[] {
  return [...new Set(values)]
    .sort((left, right) => {
      const leftRank = echelonSortOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = echelonSortOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.localeCompare(right);
    });
}

function buildPreparedUnits(dataset: RawForceCompositionDataset): PreparedForceCompositionUnit[] {
  const byId = new Map<string, RawForceCompositionUnit>();
  const childrenByParentId = new Map<string, RawForceCompositionUnit[]>();

  for (const unit of dataset.units) {
    if (byId.has(unit.id)) {
      throw new Error(`Duplicate force composition id "${unit.id}"`);
    }
    byId.set(unit.id, unit);
    if (unit.parentId) {
      const siblings = childrenByParentId.get(unit.parentId) ?? [];
      siblings.push(unit);
      childrenByParentId.set(unit.parentId, siblings);
    }
  }

  return dataset.units.map((unit) => {
    const parent = unit.parentId ? byId.get(unit.parentId) : undefined;
    const displayPosition = unit.deployment ?? unit.hq!;
    const displayPositionType: ForceCompositionDisplayPositionType = unit.deployment ? 'deployment' : 'hq';
    return {
      id: unit.id,
      name: unit.name,
      side: unit.side,
      branch: unit.branch,
      unitType: unit.unitType,
      echelon: unit.echelon,
      personnelEstimate: unit.personnelEstimate,
      parentId: unit.parentId,
      parentName: parent?.name ?? '',
      childCount: childrenByParentId.get(unit.id)?.length ?? 0,
      displayLatitude: displayPosition.latitude,
      displayLongitude: displayPosition.longitude,
      displayPositionType,
      hqLatitude: unit.hq?.latitude ?? 0,
      hqLongitude: unit.hq?.longitude ?? 0,
      deploymentLatitude: unit.deployment?.latitude ?? 0,
      deploymentLongitude: unit.deployment?.longitude ?? 0,
      countryIso2: unit.countryIso2 ?? '',
      notes: unit.notes ?? '',
      aliases: unit.aliases ?? [],
      status: unit.status ?? '',
      readiness: unit.readiness ?? '',
      equipmentSummary: unit.equipmentSummary ?? [],
      sourceRefs: unit.sourceRefs ?? [],
    };
  });
}

function normalizeDataset(value: unknown): RawForceCompositionDataset {
  if (!value || typeof value !== 'object') {
    throw new Error('Force composition dataset must be an object');
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.units)) {
    throw new Error('Force composition dataset must define a units array');
  }
  const units = candidate.units.map((unit, index) => normalizeUnit(unit, index));
  return {
    datasetVersion: normalizeString(candidate.datasetVersion, 'datasetVersion'),
    updatedAt: normalizeString(candidate.updatedAt, 'updatedAt'),
    source: normalizeString(candidate.source, 'source'),
    units,
  };
}

const normalizedDataset = normalizeDataset(forceCompositionsDataset as unknown);
const preparedUnits = buildPreparedUnits(normalizedDataset);
const forceCompositionMeta: ForceCompositionDatasetMeta = {
  datasetVersion: normalizedDataset.datasetVersion,
  updatedAt: normalizedDataset.updatedAt,
  source: normalizedDataset.source,
  unitCount: preparedUnits.length,
  availableEchelons: sortEchelons(preparedUnits.map((unit) => unit.echelon)),
  sides: ['red', 'blue'],
};

let metadataSyncPromise: Promise<void> | null = null;

export function ensureForceCompositionMetadataSynced(): Promise<void> {
  if (metadataSyncPromise) return metadataSyncPromise;

  const seedMeta = {
    fetchedAt: Date.now(),
    recordCount: preparedUnits.length,
    datasetVersion: forceCompositionMeta.datasetVersion,
    updatedAt: forceCompositionMeta.updatedAt,
  };

  metadataSyncPromise = Promise.all([
    setCachedJson(FORCE_COMPOSITION_BOOTSTRAP_META_KEY, forceCompositionMeta, META_TTL_SECONDS),
    setCachedJson(FORCE_COMPOSITION_SEED_META_KEY, seedMeta, META_TTL_SECONDS),
  ])
    .then(() => undefined)
    .catch(() => undefined);

  return metadataSyncPromise;
}

export const FORCE_COMPOSITION_ECHELON_ORDER = echelonSortOrder;
export const FORCE_COMPOSITION_UNITS = preparedUnits;
export const FORCE_COMPOSITION_META = forceCompositionMeta;
export const FORCE_COMPOSITION_SIDES = VALID_SIDES;
