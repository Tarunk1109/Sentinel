import "server-only";

import type { Product, ProductCategory } from "@/lib/domain/types";

type DemoItem = {
  id: string;
  name: string;
  brand: string;
  category: ProductCategory;
  amount: number;
  highlights: string[];
};

/** Every brand, item, specification, and price here is an invented UI fixture. */
const items: DemoItem[] = [
  { id: "demo-monitor-arc", name: "ArcView Air 15", brand: "ARC", category: "monitor", amount: 179, highlights: ["15.6-inch display", "USB-C connection", "Slim travel profile"] },
  { id: "demo-monitor-nomad", name: "Nomad Panel 15.6", brand: "NOMAD", category: "monitor", amount: 149, highlights: ["15.6-inch display", "Fold-out stand", "USB-C + mini HDMI"] },
  { id: "demo-monitor-orbit", name: "Orbit Go 14", brand: "ORBIT", category: "monitor", amount: 199, highlights: ["14-inch display", "Compact footprint", "USB-C connection"] },
  { id: "demo-keyboard-form", name: "Form Keys 75", brand: "FORM", category: "keyboard", amount: 89, highlights: ["75% layout", "Mechanical switches", "USB-C connection"] },
  { id: "demo-keyboard-orbit", name: "Orbit Type Mini", brand: "ORBIT", category: "keyboard", amount: 59, highlights: ["Compact layout", "Bluetooth connection", "Low-profile keys"] },
  { id: "demo-keyboard-arc", name: "Arc Keys Pro", brand: "ARC", category: "keyboard", amount: 129, highlights: ["Full-size layout", "Mechanical switches", "Wired USB connection"] },
  { id: "demo-headphones-echo", name: "Echo Studio Wireless", brand: "ECHO", category: "headphones", amount: 129, highlights: ["Over-ear design", "Bluetooth connection", "Fold-flat ear cups"] },
  { id: "demo-headphones-form", name: "Form Audio One", brand: "FORM", category: "headphones", amount: 79, highlights: ["Over-ear design", "Wired connection", "Lightweight frame"] },
  { id: "demo-headphones-orbit", name: "Orbit Quiet Pro", brand: "ORBIT", category: "headphones", amount: 189, highlights: ["Over-ear design", "Noise cancellation", "Bluetooth connection"] },
  { id: "demo-hub-arc", name: "Arc Dock 7", brand: "ARC", category: "hub", amount: 69, highlights: ["7-port USB-C hub", "HDMI output", "USB-A + card reader"] },
  { id: "demo-hub-nomad", name: "Nomad Link 5", brand: "NOMAD", category: "hub", amount: 39, highlights: ["5-port USB-C hub", "Compact travel design", "USB-A + HDMI"] },
  { id: "demo-hub-form", name: "Form Connect 9", brand: "FORM", category: "hub", amount: 109, highlights: ["9-port USB-C hub", "Ethernet connection", "HDMI + card reader"] },
];

export function getDemoCatalog(): Product[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    brand: item.brand,
    description: "Invented demo product. Price and specifications are illustrative; this item is not offered for sale.",
    price: { amount: item.amount, currency: "USD" },
    category: item.category,
    highlights: [...item.highlights],
    compatibility: {
      status: "unverified",
      summary: "Compatibility is unverified. Device model, ports, power requirements, and manufacturer specifications must be checked before purchase.",
    },
    imageKind: item.category,
    recommended: false,
  }));
}
