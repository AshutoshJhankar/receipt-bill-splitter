"""Food and drink rules: item categories, the keyword safety check, and which items each tax applies to.

The AI labels each item (veg, egg, non-veg, alcohol...). Code then double-checks the label against
keywords in the item name, and only ever moves it in the safe direction: an item that mentions chicken
is never left as "veg", and a beer is never left as a soft drink. That way a vegetarian is never
charged for meat, and a non-drinker is never charged for alcohol, even if the model gets it wrong.

The frontend has the same rules in src/lib/rules.js; tests/rules_cases.json keeps the two in sync.
"""
from __future__ import annotations

import re

CATEGORIES = ("veg", "egg", "nonveg", "alcohol", "soft_drink", "other")
APPLIES_TO = ("food", "alcohol", "all")
DIETS = ("veg", "egg", "nonveg")

LABELS = {"veg": "veg", "egg": "egg", "nonveg": "non-veg", "alcohol": "alcohol",
          "soft_drink": "soft drink", "other": "other"}

_NONVEG = re.compile(
    r"\b(chicken|chiken|chkn|mutton|lamb|beef|pork|bacon|ham|hamburgers?|sausages?|salami|pepperoni|prawns?|shrimps?|"
    r"fish|crabs?|lobsters?|squid|calamari|octopus|oysters?|mussels?|clams?|seafood|meat|meatballs?|keema|"
    r"kheema|murg|murgh|gosht|machli|macchi|machhi|jhinga|tangdi|turkey|duck|tuna|salmon|basa|pomfret|"
    r"surmai|rawas|bangda|anchovy|anchovies)\b")
_NONVEG_EXCEPT = re.compile(r"\b(vegan|mock|faux|plant[\s-]?based)\b")

_ALCOHOL_WORDS = re.compile(
    r"\b(beers?|wines?|whisky|whiskey|whiskies|vodka|rum|gin|tequila|brandy|cognac|bourbon|liquor|liqueur|"
    r"champagne|prosecco|lager|stout|ipa|cider|breezer|mojito|sangria|martini|mimosa|daiquiri|negroni|"
    r"cosmopolitan|bloody mary|long island|pegs?)\b")
_ALCOHOL_BRANDS = re.compile(
    r"\b(kingfisher|budweiser|heineken|corona|carlsberg|tuborg|bira|hoegaarden|stella artois|haywards|bacardi|"
    r"smirnoff|absolut|jack daniel'?s?|jameson|johnnie walker|black label|chivas|glenfiddich|glenlivet|"
    r"blenders pride|royal stag|old monk|magic moments|j[aä]germeister|j[aä]ger|baileys|sula|jacob'?s creek|amrut)\b")
_NOT_ALCOHOL = re.compile(
    r"\b(mocktails?|virgin|non[\s-]?alcoholic|alcohol[\s-]?free|zero)\b|\b0\.0\b|\b0\s?%")
_SURROGATE = re.compile(r"\b(soda|water)\b")  # "Kingfisher Soda" is a liquor brand's soda, not beer

_EGG = re.compile(r"\b(eggs?|omelets?|omelettes?|omlette|anda|frittata)\b")
_NOT_EGG = re.compile(r"\b(eggless|egg[\s-]?free|no[\s-]eggs?|without[\s-]eggs?)\b")

# Only used to guess a label when the AI gave none (e.g. items typed in by hand).
_SOFT_DRINK = re.compile(
    r"\b(coke|coca[\s-]?cola|pepsi|sprite|fanta|thums[\s-]?up|limca|7[\s-]?up|mountain dew|red bull|soda|"
    r"lemonade|nimbu|juice|mocktails?|virgin|iced tea|ice tea|cold coffee|coffee|tea|chai|lassi|buttermilk|"
    r"chaas|milkshake|shake|smoothie|water|cold drink|soft drink|aerated)\b")
_VEG = re.compile(
    r"\b(paneer|dal|daal|veg|veggie|vegetables?|vegetarian|vegan|aloo|gobi|palak|chana|chole|rajma|"
    r"mushrooms?|corn|naan|roti|rotis|kulcha|paratha|rice|jeera|pulao|dosa|idli|vada|sambar|uttapam|salad|"
    r"fries|papad|raita|bhindi|baingan|tofu|margherita|gulab jamun|rasmalai|kulfi|ice cream|halwa|kheer)\b")

_SYNONYMS = {
    "veg": "veg", "vegetarian": "veg", "vegan": "veg", "veg food": "veg", "jain": "veg",
    "egg": "egg", "eggetarian": "egg", "contains egg": "egg", "egg based": "egg",
    "nonveg": "nonveg", "non veg": "nonveg", "non vegetarian": "nonveg", "meat": "nonveg", "chicken": "nonveg",
    "fish": "nonveg", "seafood": "nonveg",
    "alcohol": "alcohol", "alcoholic": "alcohol", "liquor": "alcohol", "beer": "alcohol", "wine": "alcohol",
    "spirits": "alcohol", "spirit": "alcohol", "bar": "alcohol", "cocktail": "alcohol", "alcoholic drink": "alcohol",
    "soft drink": "soft_drink", "soft drinks": "soft_drink", "softdrink": "soft_drink", "beverage": "soft_drink",
    "beverages": "soft_drink", "drink": "soft_drink", "drinks": "soft_drink", "non alcoholic": "soft_drink",
    "mocktail": "soft_drink", "juice": "soft_drink",
    "other": "other", "unknown": "other", "misc": "other", "none": "other",
}


def _clean(text: str | None) -> str:
    return " ".join(str(text or "").lower().replace("’", "'").split())


def normalize_category(raw: object) -> str:
    """Map whatever the model returned ("Non-Veg", "beverage", None...) to one of CATEGORIES."""
    key = re.sub(r"[_\-/]+", " ", _clean(raw if isinstance(raw, str) else "")).strip()
    return _SYNONYMS.get(key, _SYNONYMS.get(key.replace(" ", ""), "other"))


def _nonveg_word(name: str) -> str | None:
    m = _NONVEG.search(name)
    return m.group(1) if m and not _NONVEG_EXCEPT.search(name) else None


def _alcohol_word(name: str) -> str | None:
    if _NOT_ALCOHOL.search(name):
        return None
    m = _ALCOHOL_WORDS.search(name)
    if m:
        return m.group(1)
    m = _ALCOHOL_BRANDS.search(name)
    return m.group(1) if m and not _SURROGATE.search(name) else None


def _egg_word(name: str) -> str | None:
    m = _EGG.search(name)
    return m.group(1) if m and not _NOT_EGG.search(name) else None


def guess_category(name: str) -> str:
    """Best guess from the name alone. Checked in order: non-veg, alcohol, egg, soft drink, veg."""
    n = _clean(name)
    if _nonveg_word(n):
        return "nonveg"
    if _alcohol_word(n):
        return "alcohol"
    if _egg_word(n):
        return "egg"
    if _SOFT_DRINK.search(n):
        return "soft_drink"
    if _VEG.search(n):
        return "veg"
    return "other"


def categorize(name: str, ai_category: object) -> tuple[str, str | None]:
    """
    Final category for an item, and a note when the keyword check overrode the AI's label.
    Items the AI didn't label are guessed from the name. The check only moves a label in the safe direction.
    """
    n = _clean(name)
    ai = normalize_category(ai_category)
    base = ai if ai != "other" else guess_category(n)

    meat = _nonveg_word(n)
    if meat and base != "nonveg":
        final, word = "nonveg", meat
    elif (drink := _alcohol_word(n)) and base not in ("alcohol", "nonveg"):
        final, word = "alcohol", drink
    elif (egg := _egg_word(n)) and base in ("veg", "soft_drink", "other"):
        final, word = "egg", egg
    else:
        return base, None
    note = f"marked {LABELS[final]} (mentions '{word}')" if ai != "other" else None
    return final, note


def applies_to_for(label: str) -> str:
    """Which items a tax or charge is spread over: VAT is charged on liquor, GST on food; the rest on everything."""
    t = _clean(label)
    if re.search(r"(?<![a-z])(vat|liquor|alcohol|bar|beer|wine|excise)(?![a-z])", t):
        return "alcohol"
    if re.search(r"(?<![a-z])((c|s|i|ut)?gst|food)(?![a-z])", t):
        return "food"
    return "all"
