import "server-only";

import type { Product, UnderstoodIntent } from "@/lib/domain/types";
import { getDemoCatalog } from "@/lib/server/demo/catalog";
import type { ProductDiscoveryService } from "@/lib/server/services/contracts";

export class DemoProductDiscoveryService implements ProductDiscoveryService {
  async search(intent: UnderstoodIntent): Promise<Product[]> {
    if (!intent.category || intent.currency !== "USD") return [];

    return getDemoCatalog()
      .filter((product) => product.category === intent.category)
      .filter((product) => {
        if (intent.minimumBudget !== null && product.price.amount < intent.minimumBudget) return false;
        if (!intent.budget) return true;
        return intent.budget.inclusive
          ? product.price.amount <= intent.budget.amount
          : product.price.amount < intent.budget.amount;
      })
      .map((product, index) => ({ ...product, recommended: index === 0 }));
  }
}
