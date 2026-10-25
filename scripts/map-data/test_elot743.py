import pytest
from elot743 import transliterate

@pytest.mark.parametrize("greek,latin", [
    ("Οδός Ερμού", "Odos Ermou"),
    ("Ερμούπολη", "Ermoupoli"),
    ("Άνω Σύρος", "Ano Syros"),
    ("Άγιος Νικόλαος", "Agios Nikolaos"),
    ("Γαλησσάς", "Galissas"),
    ("Χρούσσα", "Chroussa"),
    ("Θεοτόκου", "Theotokou"),
    ("Ψαρή", "Psari"),
    ("Ευαγγελίστρια", "Evangelistria"),   # ευ before a voiced sound -> ev; γγ -> ng
    ("Ευκλείδου", "Efkleidou"),           # ευ before a voiceless sound -> ef
    ("Μπάτσι", "Batsi"),                  # μπ at the start of a word -> b
    ("Λαμπάδα", "Lampada"),               # μπ in the middle of a word -> mp
    ("ΚΙΝΙ", "KINI"),                     # all capitals stay all capitals
    ("Οδός 25ης Μαρτίου", "Odos 25is Martiou"),  # digits pass through
    # extras beyond the brief
    ("Μάρκος", "Markos"),
    ("Ήρα", "Ira"),
    ("Ώρα", "Ora"),
    ("Ύδρα", "Ydra"),
    ("Όλγα", "Olga"),
    ("Ίσκιος", "Iskios"),
    ("Έρμου", "Ermou"),
    ("Μαΐου", "Maiou"),                   # diaeresis splits the pair
    ("Ευϊ", "Evi"),                       # ευ not split here; ϊ after it is i
    ("Αϊ Γιώργης", "Ai Giorgis"),         # diaeresis keeps α and ι apart
    ("Ραφτόπουλο", "Raftopoulo"),
    ("Αυλή", "Avli"),
    ("Αυτός", "Aftos"),
    ("Ηύρα", "Ivra"),
    ("Σαυρός", "Savros"),
    ("Γκάζι", "Gkazi"),
    ("Ντίνος", "Ntinos"),
    ("Άγχος", "Anchos"),
    ("ΘΕΟΤΟΚΟΥ", "THEOTOKOU"),
    ("ΨΑΡΗ", "PSARI"),
    ("ΟΥ", "OU"),
    ("Θ", "Th"),
    ("ΑΥΛΗ", "AVLI"),
    ("ΑΥ", "AF"),
])
def test_transliterate(greek, latin):
    assert transliterate(greek) == latin


def test_final_sigma():
    assert transliterate("Νίκος") == "Nikos"
    assert transliterate("σας") == "sas"


def test_latin_passes_through():
    assert transliterate("Apollon Theatre") == "Apollon Theatre"


def test_mixed_text_and_punctuation():
    assert transliterate("Café Ερμού, no. 5 - Θέατρο") == "Café Ermou, no. 5 - Theatro"


def test_empty():
    assert transliterate("") == ""


def test_micro_sign_is_read_as_greek_mu():
    # Real OSM name: the sign U+00B5 typed where Greek mu (U+03BC) belongs.
    assert transliterate("Σίµου Κοντιζά") == "Simou Kontiza"
    assert transliterate("Σίµου") == "Simou"


@pytest.mark.parametrize("zw", ["​", "‌", "‍", "﻿"])
def test_zero_width_characters_are_dropped(zw):
    # Real OSM name: a zero-width space leads the string.
    assert transliterate(f"{zw}Η παραλία της Ευτυχίας") == "I paralia tis Eftychias"
    # ...and mid-word ones must not split a digraph such as ου.
    assert transliterate(f"Ο{zw}υ") == "Ou"
