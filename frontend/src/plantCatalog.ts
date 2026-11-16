/** Tanui Plastic Plant — outdoor plastic accessories demo. */

export const PLANT = {
  siteName: 'Tanui Plastic Plant',
  location: 'Injection molding · Outdoor accessories',
  exteriorImage: '/plant/plant-exterior.jpg',
  tagline: 'Outdoor plastic accessories · Injection molding',
}

export type PlantProduct = {
  code: string
  name: string
  image: string
  hourlyTarget: number
  cycleSeconds: number
  unit: string
}

export const PRODUCTS: PlantProduct[] = [
  {
    code: 'STO-240',
    name: 'Garden Storage Box 240L',
    image: '/plant/product-storage-box.jpg',
    hourlyTarget: 48,
    cycleSeconds: 75,
    unit: 'pcs',
  },
  {
    code: 'CHR-01',
    name: 'Outdoor Garden Chair',
    image: '/plant/product-garden-chair.jpg',
    hourlyTarget: 36,
    cycleSeconds: 100,
    unit: 'pcs',
  },
  {
    code: 'PLN-35',
    name: 'Ribbed Planter 35cm',
    image: '/plant/product-planter.jpg',
    hourlyTarget: 90,
    cycleSeconds: 40,
    unit: 'pcs',
  },
  {
    code: 'CAB-XL',
    name: 'Outdoor Utility Cabinet',
    image: '/plant/product-cabinet.jpg',
    hourlyTarget: 24,
    cycleSeconds: 150,
    unit: 'pcs',
  },
  {
    code: 'SHF-5T',
    name: 'Modular Shelf 5-Tier',
    image: '/plant/product-shelf.jpg',
    hourlyTarget: 30,
    cycleSeconds: 120,
    unit: 'pcs',
  },
]

export type PlantMachine = {
  code: string
  name: string
  type: string
  line: string
  image: string
  productCode: string
}

export const MACHINES: PlantMachine[] = [
  {
    code: 'IMM-01',
    name: 'Engel Duo 700',
    type: 'Injection Press',
    line: 'Molding Hall A',
    image: '/plant/imm-press.jpg',
    productCode: 'STO-240',
  },
  {
    code: 'IMM-02',
    name: 'Engel Victory 500',
    type: 'Injection Press',
    line: 'Molding Hall A',
    image: '/plant/imm-press-b.jpg',
    productCode: 'CHR-01',
  },
  {
    code: 'IMM-03',
    name: 'KraussMaffei CX 350',
    type: 'Injection Press',
    line: 'Molding Hall A',
    image: '/plant/imm-press.jpg',
    productCode: 'PLN-35',
  },
  {
    code: 'IMM-04',
    name: 'Engel Duo 1100',
    type: 'Injection Press',
    line: 'Molding Hall B',
    image: '/plant/imm-press-b.jpg',
    productCode: 'CAB-XL',
  },
  {
    code: 'IMM-05',
    name: 'Husky HyPET 300',
    type: 'Injection Press',
    line: 'Molding Hall B',
    image: '/plant/imm-press.jpg',
    productCode: 'SHF-5T',
  },
  {
    code: 'IMM-06',
    name: 'Engel Victory 280',
    type: 'Injection Press',
    line: 'Molding Hall B',
    image: '/plant/imm-press-b.jpg',
    productCode: 'PLN-35',
  },
  {
    code: 'ASM-01',
    name: 'Assembly Cell North',
    type: 'Assembly',
    line: 'Finishing',
    image: '/plant/imm-press.jpg',
    productCode: 'STO-240',
  },
  {
    code: 'ASM-02',
    name: 'Assembly Cell South',
    type: 'Assembly',
    line: 'Finishing',
    image: '/plant/imm-press-b.jpg',
    productCode: 'CAB-XL',
  },
]

export function productByCode(code?: string | null) {
  return PRODUCTS.find((p) => p.code === code) || PRODUCTS[0]
}

export function machineByCode(code?: string | null) {
  return MACHINES.find((m) => m.code === code) || MACHINES[0]
}

export function machineByIndex(id: number) {
  const idx = Math.max(0, (id - 1) % MACHINES.length)
  return MACHINES[idx]
}
