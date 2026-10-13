import {
  normalizeAxes,
  canonicalKey,
  buildVariantMap,
  resolveVariantId,
  computeRunningTotal,
  coerceQty,
} from "../assortmentModel";

// Real shapes confirmed against acgbrands (docs/API-NOTES.md).
// variationAttributeInfo is an object keyed by apiName, with NO per-entry sequence.
const ATTR_INFO = {
  // Deliberately listed Colors-first to prove axis order does NOT come from this object.
  Clothing_Colors__c: {
    apiName: "Clothing_Colors__c",
    label: "Color",
    availableValues: ["Black", "Navy", "Grey"],
  },
  Clothing_Sizes__c: {
    apiName: "Clothing_Sizes__c",
    label: "Size",
    availableValues: ["Small", "Medium", "Large", "XL"],
  },
};

// attributesToProductMappings is an array; sequence lives on selectedAttributes
// (Sizes=0, Colors=1). Only a subset of the full grid is mapped here on purpose.
const MAPPINGS = [
  {
    productId: "01tMEDBLK",
    canonicalKey: "Medium_Black",
    selectedAttributes: [
      { apiName: "Clothing_Sizes__c", sequence: 0, value: "Medium" },
      { apiName: "Clothing_Colors__c", sequence: 1, value: "Black" },
    ],
  },
  {
    productId: "01tSMLNVY",
    canonicalKey: "Small_Navy",
    selectedAttributes: [
      { apiName: "Clothing_Colors__c", sequence: 1, value: "Navy" },
      { apiName: "Clothing_Sizes__c", sequence: 0, value: "Small" },
    ],
  },
];

describe("normalizeAxes", () => {
  test("orders axes by mapping sequence, not by object key order", () => {
    const axes = normalizeAxes(ATTR_INFO, MAPPINGS);
    expect(axes.map((a) => a.apiName)).toEqual([
      "Clothing_Sizes__c",
      "Clothing_Colors__c",
    ]);
  });

  test("takes value lists from availableValues with labels", () => {
    const axes = normalizeAxes(ATTR_INFO, MAPPINGS);
    const sizeAxis = axes[0];
    expect(sizeAxis.label).toBe("Size");
    expect(sizeAxis.values).toEqual([
      { value: "Small", label: "Small" },
      { value: "Medium", label: "Medium" },
      { value: "Large", label: "Large" },
      { value: "XL", label: "XL" },
    ]);
  });

  test("returns [] when variationAttributeInfo is null", () => {
    expect(normalizeAxes(null, MAPPINGS)).toEqual([]);
  });
});

describe("canonicalKey", () => {
  test("joins axis values in axis order, independent of input order", () => {
    const axes = normalizeAxes(ATTR_INFO, MAPPINGS);
    expect(canonicalKey(axes, { Clothing_Colors__c: "Black", Clothing_Sizes__c: "Medium" })).toBe(
      "Medium|Black"
    );
  });
});

describe("buildVariantMap / resolveVariantId", () => {
  test("resolves a mapped size+color combo to its productId regardless of selectedAttributes order", () => {
    const axes = normalizeAxes(ATTR_INFO, MAPPINGS);
    const map = buildVariantMap(axes, MAPPINGS);
    expect(
      resolveVariantId(map, axes, { Clothing_Sizes__c: "Small", Clothing_Colors__c: "Navy" })
    ).toBe("01tSMLNVY");
  });

  test("returns null for an unmapped combo", () => {
    const axes = normalizeAxes(ATTR_INFO, MAPPINGS);
    const map = buildVariantMap(axes, MAPPINGS);
    expect(
      resolveVariantId(map, axes, { Clothing_Sizes__c: "XL", Clothing_Colors__c: "Grey" })
    ).toBeNull();
  });
});

describe("computeRunningTotal", () => {
  test("sums unitPrice * qty across cells, ignoring zero/blank/unpriced", () => {
    const cells = [
      { productId: "a", qty: 2, unitPrice: 10 },
      { productId: "b", qty: 3, unitPrice: 5.5 },
      { productId: "c", qty: 0, unitPrice: 99 },
      { productId: "d", qty: 4, unitPrice: null },
    ];
    expect(computeRunningTotal(cells)).toBeCloseTo(36.5, 2);
  });

  test("is 0 for an empty assortment", () => {
    expect(computeRunningTotal([])).toBe(0);
  });
});

describe("coerceQty", () => {
  test("floors to a non-negative integer", () => {
    expect(coerceQty("3.7")).toBe(3);
    expect(coerceQty(-4)).toBe(0);
    expect(coerceQty("abc")).toBe(0);
    expect(coerceQty("")).toBe(0);
  });

  test("caps at purchaseQuantityRule.maximum", () => {
    expect(coerceQty(99, { maximum: "10" })).toBe(10);
  });

  test("bumps a nonzero qty up to purchaseQuantityRule.minimum but leaves zero at zero", () => {
    expect(coerceQty(2, { minimum: "4" })).toBe(4);
    expect(coerceQty(0, { minimum: "4" })).toBe(0);
  });

  test("snaps to purchaseQuantityRule.increment", () => {
    expect(coerceQty(7, { increment: "5" })).toBe(5);
    expect(coerceQty(3, { increment: "5" })).toBe(5);
    expect(coerceQty(0, { increment: "5" })).toBe(0);
  });
});
