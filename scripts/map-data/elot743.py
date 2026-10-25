"""Greek to Latin transliteration following ELOT 743 (the road-sign standard)."""
import re
import unicodedata

_SINGLE = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i",
    "θ": "th", "ι": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x",
    "ο": "o", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "υ": "y",
    "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o",
}
_PAIRS = {
    "αι": "ai", "ει": "ei", "οι": "oi", "ου": "ou", "υι": "yi",
    "γγ": "ng", "γκ": "gk", "γξ": "nx", "γχ": "nch", "ντ": "nt",
}
_VOWELS = set("αεηιουω")
_VOICED = set("βγδζλμνρ") | _VOWELS
_DIAERESIS = "̈"
# Data glitches seen in OSM names: invisible characters inside or before a word, and the
# micro sign (U+00B5) typed where Greek mu (U+03BC) belongs. Neither is a Greek letter,
# so left alone they split words and leak into the output.
_ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\ufeff"))
_CLEAN = {**_ZERO_WIDTH, 0xB5: "\u03bc"}
_RUN = re.compile("[Ͱ-Ͽἀ-῿][Ͱ-Ͽἀ-῿̀-ͯ]*")


def _tokens(run):
    """Return (lowercase base letter, was_upper, has_diaeresis) per letter."""
    out = []
    for ch in unicodedata.normalize("NFD", run):
        if unicodedata.combining(ch):
            if ch == _DIAERESIS and out:
                out[-1][2] = True
            continue
        out.append([ch.lower(), ch != ch.lower(), False])
    return out


def _run(run):
    toks = _tokens(run)
    letters = [t for t in toks if t[0] in _SINGLE]
    all_caps = len(letters) > 1 and all(t[1] for t in letters)
    out = []
    i = 0
    while i < len(toks):
        ch, upper, _ = toks[i]
        nxt = toks[i + 1] if i + 1 < len(toks) else None
        span, text = 1, None
        if nxt is not None and not nxt[2]:
            pair = ch + nxt[0]
            if pair in ("αυ", "ευ", "ηυ"):
                after = toks[i + 2][0] if i + 2 < len(toks) else None
                voiced = after is not None and after in _VOICED
                text = {"α": "a", "ε": "e", "η": "i"}[ch] + ("v" if voiced else "f")
                span = 2
            elif pair == "μπ":
                text = "b" if i == 0 else "mp"
                span = 2
            elif pair in _PAIRS:
                text = _PAIRS[pair]
                span = 2
        if text is None:
            text = _SINGLE.get(ch)
            if text is None:
                out.append("".join(unicodedata.normalize("NFC", ch)))
                i += 1
                continue
        out.append(text.upper() if all_caps else text.capitalize() if upper else text)
        i += span
    return "".join(out)


def transliterate(greek: str) -> str:
    """Spell Greek text in Latin letters; non-Greek characters pass through."""
    return _RUN.sub(lambda m: _run(m.group(0)), greek.translate(_CLEAN))
