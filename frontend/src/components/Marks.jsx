import { CATEGORIES, CATEGORY_LABEL } from "../lib/rules.js";

/** The familiar Indian food marks (green = veg, brown triangle = non-veg), plus egg and drinks. */
export function CategoryMark({ category }) {
  if (category === "alcohol") return <span className="mark-emoji" aria-hidden>🍺</span>;
  if (category === "soft_drink") return <span className="mark-emoji" aria-hidden>🥤</span>;
  return <span className={`mark mark-${category}`} aria-hidden />;
}

/** A category mark that opens a picker when tapped (a native select laid over the mark). */
export function CategoryPicker({ value, onChange, label }) {
  return (
    <label className="cat-pick" title={`${CATEGORY_LABEL[value]} (tap to change)`}>
      <CategoryMark category={value} />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
    </label>
  );
}

const DIET_TITLE = { veg: "Vegetarian", egg: "Eats egg, no meat", nonveg: "Eats non-veg" };

/** Small read-only tags after a person's name: their diet, and 🍺 if they drink. */
export function PersonTags({ person }) {
  if (!person) return null;
  return (
    <span className="ptags">
      {person.diet !== "nonveg" && (
        <span className="ptag" title={DIET_TITLE[person.diet]}>
          <CategoryMark category={person.diet} /> {person.diet === "veg" ? "veg" : "egg"}
        </span>
      )}
      {person.drinks && <span className="ptag" title="Drinks alcohol">🍺</span>}
    </span>
  );
}
