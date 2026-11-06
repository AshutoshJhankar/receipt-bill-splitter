import { newId } from "./nav.js";

/**
 * Draft item: aiCat is the scan's label, cat the user's own pick (null = automatic).
 * shared_by only counts once edited is true; until then the food and drink rules decide who shares it.
 */
export const blankItem = () => ({ id: newId("i"), name: "", qty: "1", amount: "", aiCat: null, cat: null, edited: false, shared_by: [] });

/** Draft charge: applies is the user's pick of food / alcohol / all (null = guessed from the label). */
export const blankCharge = (label = "GST") => ({ id: newId("c"), label, amount: "", applies: null });
