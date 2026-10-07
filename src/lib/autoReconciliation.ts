export type AutoMatchCandidateType = "factura" | "rendicion" | "cheque" | "webpay" | "commitment";

export type AutoMatchMovement = {
  id: string;
  fecha: string;
  monto: number;
};

export type AutoMatchCandidate = {
  id: string;
  type: AutoMatchCandidateType;
  direction: "inflow" | "outflow";
  amount: number;
  /** Fechas de referencia (emisión, vencimiento, fecha esperada...). Se usa la más cercana al movimiento. */
  dates: Array<string | null | undefined>;
};

export type AutoMatchOption = {
  candidateId: string;
  dayDistance: number;
};

export type AutoMatchSuggestion = {
  movementId: string;
  candidateId: string;
  dayDistance: number;
  /** Todas las opciones válidas del movimiento (incluida la sugerida), ordenadas por cercanía de fecha. */
  options: AutoMatchOption[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const toDayNumber = (value: string) => {
  const time = Date.parse(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(time) ? null : Math.round(time / DAY_MS);
};

export const getDayDistance = (movementDate: string, dates: AutoMatchCandidate["dates"]) => {
  const movementDay = toDayNumber(movementDate);
  if (movementDay === null) return null;
  let best: number | null = null;
  for (const date of dates) {
    if (!date) continue;
    const day = toDayNumber(date);
    if (day === null) continue;
    const distance = Math.abs(movementDay - day);
    if (best === null || distance < best) best = distance;
  }
  return best;
};

/**
 * Sugiere un documento por movimiento cuando el monto coincide y la fecha está dentro de la ventana.
 * Cada documento se asigna a un solo movimiento: primero se resuelven los pares más cercanos en fecha
 * y, ante empates, los movimientos con menos alternativas.
 */
export const buildAutoMatchSuggestions = (
  movements: AutoMatchMovement[],
  candidates: AutoMatchCandidate[],
  options: { maxDays: number; amountTolerance?: number }
): AutoMatchSuggestion[] => {
  const tolerance = options.amountTolerance ?? 0.01;
  const optionsByMovement = new Map<string, AutoMatchOption[]>();

  for (const movement of movements) {
    const direction = movement.monto >= 0 ? "inflow" : "outflow";
    const bankAmount = Math.abs(movement.monto);
    if (bankAmount <= tolerance) continue;

    const movementOptions: AutoMatchOption[] = [];
    for (const candidate of candidates) {
      if (candidate.direction !== direction) continue;
      if (Math.abs(candidate.amount - bankAmount) > tolerance) continue;
      const dayDistance = getDayDistance(movement.fecha, candidate.dates);
      if (dayDistance === null || dayDistance > options.maxDays) continue;
      movementOptions.push({ candidateId: candidate.id, dayDistance });
    }

    if (movementOptions.length > 0) {
      movementOptions.sort((a, b) => a.dayDistance - b.dayDistance);
      optionsByMovement.set(movement.id, movementOptions);
    }
  }

  const pairs = Array.from(optionsByMovement.entries()).flatMap(([movementId, movementOptions]) =>
    movementOptions.map((option) => ({ movementId, ...option, alternatives: movementOptions.length }))
  );
  pairs.sort((a, b) => a.dayDistance - b.dayDistance || a.alternatives - b.alternatives);

  const assignedMovements = new Map<string, AutoMatchOption>();
  const usedCandidates = new Set<string>();
  for (const pair of pairs) {
    if (assignedMovements.has(pair.movementId) || usedCandidates.has(pair.candidateId)) continue;
    assignedMovements.set(pair.movementId, { candidateId: pair.candidateId, dayDistance: pair.dayDistance });
    usedCandidates.add(pair.candidateId);
  }

  return movements
    .filter((movement) => assignedMovements.has(movement.id))
    .map((movement) => {
      const assigned = assignedMovements.get(movement.id)!;
      return {
        movementId: movement.id,
        candidateId: assigned.candidateId,
        dayDistance: assigned.dayDistance,
        options: optionsByMovement.get(movement.id) || [],
      };
    });
};
