import AsyncStorage from '@react-native-async-storage/async-storage';
import { isoDateKey } from '../constants/date';

export type FoodSource = 'photo' | 'label' | 'barcode' | 'manual';

export type FoodItem = {
  name: string;
  confidence?: number; // 0-1
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
};

export type FoodAnalysis = {
  score: number; // 0-100 (A)
  highlights: string[]; // A) tips/hallazgos
  items: FoodItem[]; // B) items estimados
  totals: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
};

export type MealEntry = {
  id: string;
  dateKey: string; // YYYY-MM-DD
  source: FoodSource;
  imageUri?: string; // photo/label
  barcode?: string; // C
  analysis: FoodAnalysis;
  created_at: string;
};

const STORAGE_MEALS_PREFIX = 'wr_meals_v1_';

function keyForDate(dateKey: string) {
  return STORAGE_MEALS_PREFIX + dateKey;
}

export async function listMeals(dateKey: string): Promise<MealEntry[]> {
  const raw = await AsyncStorage.getItem(keyForDate(dateKey));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as MealEntry[]) : [];
  } catch {
    return [];
  }
}

export async function addMeal(meal: MealEntry): Promise<void> {
  const curr = await listMeals(meal.dateKey);
  const next = [meal, ...curr];
  await AsyncStorage.setItem(keyForDate(meal.dateKey), JSON.stringify(next));
}

export function computeDayTotals(meals: MealEntry[]) {
  return meals.reduce(
    (acc, m) => {
      acc.calories += m.analysis.totals.calories || 0;
      acc.protein_g += m.analysis.totals.protein_g || 0;
      acc.carbs_g += m.analysis.totals.carbs_g || 0;
      acc.fat_g += m.analysis.totals.fat_g || 0;
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}

// ===== Analyzer v0 (LOCAL MOCK) =====
// Sirve para que el flujo funcione hoy. Luego lo cambiamos por backend IA real.
export function analyzeMealMock(opts: { mode: 'photo' | 'label' | 'barcode'; barcode?: string }): FoodAnalysis {
  const base = opts.mode === 'barcode' ? 72 : opts.mode === 'label' ? 68 : 65;

  const items =
    opts.mode === 'barcode'
      ? [{ name: `Producto UPC ${opts.barcode ?? ''}`.trim(), calories: 220, protein_g: 8, carbs_g: 30, fat_g: 8 }]
      : [{ name: 'Comida detectada (estimación)', calories: 520, protein_g: 28, carbs_g: 55, fat_g: 20 }];

  const totals = items.reduce(
    (a, it) => {
      a.calories += it.calories ?? 0;
      a.protein_g += it.protein_g ?? 0;
      a.carbs_g += it.carbs_g ?? 0;
      a.fat_g += it.fat_g ?? 0;
      return a;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  const highlights: string[] = [];
  if (totals.protein_g < 25) highlights.push('Tip: sube proteína (pollo/huevo/atún/yogurt griego).');
  if (totals.carbs_g > 70) highlights.push('Carbos altos: agrega fibra/verdura para bajar picos.');
  highlights.push('Recuerda: foto = estimación (confirma porciones).');

  const score = Math.max(0, Math.min(100, Math.round(base + totals.protein_g * 0.2 - totals.carbs_g * 0.05)));
  return { score, highlights, items, totals };
}

// ✅ REAL: Barcode -> Open Food Facts (sin API key)
export async function analyzeBarcodeOpenFoodFacts(barcode: string): Promise<FoodAnalysis> {
  const code = String(barcode).trim();
  if (!code) throw new Error('barcode-empty');

  const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`off-http-${res.status}`);

  const data = await res.json();
  const product = data?.product;

  if (!product) {
    return analyzeMealMock({ mode: 'barcode', barcode: code });
  }

  const name =
    product.product_name ||
    product.product_name_en ||
    product.abbreviated_product_name ||
    product.generic_name ||
    `Producto ${code}`;

  const nutr = product.nutriments || {};

  // Preferir por-serving si existe; si no, usar por-100g como estimación.
  const calories = n(nutr['energy-kcal_serving'] ?? nutr['energy-kcal'] ?? nutr['energy-kcal_100g']);
  const protein = n(nutr.proteins_serving ?? nutr.proteins ?? nutr.proteins_100g);
  const carbs = n(nutr.carbohydrates_serving ?? nutr.carbohydrates ?? nutr.carbohydrates_100g);
  const fat = n(nutr.fat_serving ?? nutr.fat ?? nutr.fat_100g);

  const items: FoodItem[] = [
    {
      name,
      confidence: 0.95,
      calories: round1(calories),
      protein_g: round1(protein),
      carbs_g: round1(carbs),
      fat_g: round1(fat),
    },
  ];

  const totals = {
    calories: round1(calories),
    protein_g: round1(protein),
    carbs_g: round1(carbs),
    fat_g: round1(fat),
  };

  const highlights: string[] = [];
  if (totals.protein_g >= 20) highlights.push('Buen aporte de proteína.');
  if (totals.carbs_g >= 50) highlights.push('Carbos altos: equilibra con fibra/proteína.');
  if (totals.fat_g >= 20) highlights.push('Grasa alta: ojo con porciones.');
  if (!highlights.length) highlights.push('Datos de etiqueta detectados.');

  const score = Math.max(
    0,
    Math.min(100, Math.round(60 + totals.protein_g * 0.6 - totals.carbs_g * 0.15 - totals.fat_g * 0.1))
  );

  return { score, highlights, items, totals };
}

export function makeMealId() {
  return `meal_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function todayKey() {
  return isoDateKey(new Date());
}