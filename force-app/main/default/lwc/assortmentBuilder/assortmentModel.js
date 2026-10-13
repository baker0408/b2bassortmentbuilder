/**
 * Pure grid-logic for the assortment builder. No LWC, no wire, no DOM — just
 * data transforms over the variation shapes documented in docs/API-NOTES.md,
 * so this file is unit-testable in isolation.
 *
 * Axis order is authoritative from attributesToProductMappings[].selectedAttributes[].sequence
 * (variationAttributeInfo carries no sequence — see ruling R3). Quantity coercion
 * honors a product-level purchaseQuantityRule when present (ruling R4).
 */

/**
 * Build the ordered axis descriptors for the grid.
 * @param {Object|Array} variationAttributeInfo - object keyed by apiName (or array of entries).
 * @param {Array} mappings - attributesToProductMappings; sequence lives on selectedAttributes.
 * @returns {Array<{apiName,label,sequence,values:Array<{value,label}>}>} sorted by sequence.
 */
export function normalizeAxes(variationAttributeInfo, mappings) {
  if (!variationAttributeInfo) {
    return [];
  }

  // Derive the authoritative axis order from the mappings' selectedAttributes sequence.
  const seqByApi = {};
  (mappings || []).forEach((m) => {
    (m.selectedAttributes || []).forEach((sel) => {
      if (seqByApi[sel.apiName] === undefined && sel.sequence != null) {
        seqByApi[sel.apiName] = Number(sel.sequence);
      }
    });
  });

  const entries = Array.isArray(variationAttributeInfo)
    ? variationAttributeInfo
    : Object.keys(variationAttributeInfo).map((key) => ({
        apiName: variationAttributeInfo[key].apiName || key,
        ...variationAttributeInfo[key],
      }));

  return entries
    .map((entry, idx) => ({
      apiName: entry.apiName,
      label: entry.label || entry.apiName,
      sequence: seqByApi[entry.apiName] !== undefined ? seqByApi[entry.apiName] : idx,
      values: (entry.availableValues || entry.values || []).map((v) =>
        typeof v === "string"
          ? { value: v, label: v }
          : { value: v.value, label: v.label || v.value }
      ),
    }))
    .sort((a, b) => a.sequence - b.sequence);
}

/**
 * Canonical key for a selected-value set, in axis order so lookups are
 * independent of the order the caller supplies the values in.
 * @param {Array} axes - from normalizeAxes.
 * @param {Object} valuesByApi - { apiName: value }.
 * @returns {string} e.g. "Medium|Black".
 */
export function canonicalKey(axes, valuesByApi) {
  return axes.map((axis) => valuesByApi[axis.apiName]).join("|");
}

/**
 * Index the mapped child products by canonical key.
 * @param {Array} axes - from normalizeAxes.
 * @param {Array} mappings - attributesToProductMappings.
 * @returns {Object} { canonicalKey: productId }.
 */
export function buildVariantMap(axes, mappings) {
  const map = {};
  (mappings || []).forEach((m) => {
    const valuesByApi = {};
    (m.selectedAttributes || []).forEach((sel) => {
      valuesByApi[sel.apiName] = sel.value;
    });
    map[canonicalKey(axes, valuesByApi)] = m.productId;
  });
  return map;
}

/**
 * Resolve a selected size+color combo to its child productId, or null if the
 * combination isn't an orderable variant.
 * @returns {string|null}
 */
export function resolveVariantId(variantMap, axes, valuesByApi) {
  const id = variantMap[canonicalKey(axes, valuesByApi)];
  return id === undefined ? null : id;
}

/**
 * Running total = Σ(unitPrice × qty) over cells, skipping zero/blank/unpriced.
 * @param {Array<{qty:number,unitPrice:number|null}>} cells
 * @returns {number}
 */
export function computeRunningTotal(cells) {
  return (cells || []).reduce((sum, cell) => {
    const qty = Number(cell.qty);
    const price = Number(cell.unitPrice);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price)) {
      return sum;
    }
    return sum + price * qty;
  }, 0);
}

/**
 * Coerce a raw quantity input to a valid non-negative integer, honoring an
 * optional purchaseQuantityRule { minimum, maximum, increment } (ruling R4).
 * Zero always stays zero (an un-ordered cell), even under a minimum.
 * @param {*} raw
 * @param {Object} [rule]
 * @returns {number}
 */
export function coerceQty(raw, rule) {
  let n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  if (rule) {
    const inc = Number(rule.increment);
    if (Number.isFinite(inc) && inc > 1) {
      n = Math.floor(n / inc) * inc;
      if (n === 0) {
        n = inc;
      }
    }
    const min = Number(rule.minimum);
    if (Number.isFinite(min) && min > 0 && n < min) {
      n = min;
    }
    const max = Number(rule.maximum);
    if (Number.isFinite(max) && max > 0 && n > max) {
      n = max;
    }
  }
  return n;
}
