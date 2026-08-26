import {
  Bus, Car, Coffee, CreditCard, Dumbbell, GraduationCap, HeartPulse, Home,
  Landmark, PawPrint, Plane, Receipt, Shirt, ShoppingBag, ShoppingCart, Smartphone,
  Sparkles, Tv, Utensils, Wallet, Wrench, type LucideIcon,
} from "lucide-react";

/** Palavras-chave → ícone. Casamento por substring, sem acento. */
const RULES: [RegExp, LucideIcon][] = [
  [/mercado|supermercad|feira|compras/, ShoppingCart],
  [/aliment|restaurante|comida|lanche|delivery|ifood/, Utensils],
  [/cafe|padaria|bar\b/, Coffee],
  [/transporte|uber|taxi|onibus|metro|passagem/, Bus],
  [/carro|combustivel|gasolina|estacionamento|veicul/, Car],
  [/moradia|aluguel|casa|condominio|imovel/, Home],
  [/conta|luz|agua|energia|gas|internet|telefone/, Receipt],
  [/celular|tecnologia|eletronic/, Smartphone],
  [/saude|farmacia|medic|hospital|dentista/, HeartPulse],
  [/academia|esporte|fitness/, Dumbbell],
  [/educa|curso|faculdade|escola|livro/, GraduationCap],
  [/lazer|streaming|cinema|netflix|assinatura/, Tv],
  [/viagem|hotel|turismo|passagem aerea/, Plane],
  [/roupa|vestuario|moda/, Shirt],
  [/pet|animal|veterinar/, PawPrint],
  [/beleza|salao|cosmetic/, Sparkles],
  [/servico|manutencao|reforma|conserto/, Wrench],
  [/salario|renda|receita|pagamento|freela|invest/, Landmark],
  [/cartao|fatura|credito/, CreditCard],
  [/compra|loja|shopping/, ShoppingBag],
];

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function categoryIcon(category?: string | null, type?: "income" | "expense"): LucideIcon {
  const name = norm(category ?? "");
  if (!name) return type === "income" ? Landmark : Wallet;
  for (const [re, icon] of RULES) if (re.test(name)) return icon;
  return type === "income" ? Landmark : Wallet;
}

/** Índice estável de cor (mesma categoria → sempre a mesma cor). */
export function categoryColorIndex(category?: string | null): number {
  const name = norm(category ?? "");
  if (!name) return 0;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 8;
}
