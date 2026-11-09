"use client";

import { useEffect } from "react";
import { trackRecipeFunnel } from "@/lib/recipe-funnel-client";

export function RecipeExampleView({ enabled }: { enabled: boolean }) {
  useEffect(() => { trackRecipeFunnel(enabled, "example"); }, [enabled]);
  return null;
}
