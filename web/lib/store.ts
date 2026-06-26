"use client";

import { create } from "zustand";
import type { DonePayload } from "./types";

interface ErpRealSoftState {
  // The result of the most recent upload pipeline (mirrors Streamlit last_result).
  lastResult: DonePayload | null;
  setLastResult: (r: DonePayload | null) => void;

  // Strict mode toggle (passed to the upload endpoint).
  strict: boolean;
  setStrict: (v: boolean) => void;
}

export const useErpRealSoftStore = create<ErpRealSoftState>((set) => ({
  lastResult: null,
  setLastResult: (r) => set({ lastResult: r }),
  strict: false,
  setStrict: (v) => set({ strict: v }),
}));
