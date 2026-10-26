from urllib.parse import unquote

import pytest

from app.filenames import (
    MAX_NAME_BYTES,
    MAX_TITLE_CHARS,
    ascii_fallback,
    build_download_name,
    content_disposition,
    sanitize_title,
)


def test_basic_name() -> None:
    assert build_download_name("Me at the zoo", "jNQXAC9IVRw", "mp4") == "Me at the zoo [jNQXAC9IVRw].mp4"


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("../../etc/passwd", "etc passwd"),
        ("a/b\\c:d*e?f\"g<h>i|j", "a b c d e f g h i j"),
        ("  spaced   out  ", "spaced out"),
        ("tab\tand\nnewline", "tab and newline"),
        ("...hidden", "hidden"),
        ("emoji 🎉 ok", "emoji 🎉 ok"),
        ("東京タワー", "東京タワー"),
        ("bidi‮evil​", "bidievil"),
        ("", "media"),
        (None, "media"),
        ("////", "media"),
    ],
)
def test_sanitize_title(title: str | None, expected: str) -> None:
    assert sanitize_title(title) == expected


def test_nfc_normalization() -> None:
    decomposed = "Café"
    assert sanitize_title(decomposed) == "Café"


def test_long_unicode_title_fits_in_255_bytes() -> None:
    name = build_download_name("東" * 500, "abcdefghijk", "mp4")
    assert len(name.encode()) <= MAX_NAME_BYTES
    assert name.endswith(" [abcdefghijk].mp4")


def test_id_and_ext_are_sanitized() -> None:
    assert build_download_name("t", "../x/y", "m p4/") == "t [xy].mp4"


def test_derived_name_keeps_its_label_and_shortens_the_title() -> None:
    # An imported file named after a download (« … [id].mp4 »): « Title (montage 6s-11s) » > MAX_TITLE_CHARS.
    # The label used to be cut: « … [dmPQL84nv28] (montage 6s-11.mp4 ».
    title = "How to actually get rich from AI the complete guide nobody tells you about (official video) [dmPQL84nv28]"
    name = build_download_name(title, None, "mp4", label="(montage 6s-11s)")
    assert name == ("How to actually get rich from AI the complete guide nobody tells you about (official video) "
                    "[dmPQL84nv… (montage 6s-11s).mp4")
    assert len(name.removesuffix(".mp4")) == MAX_TITLE_CHARS
    assert 'filename="How to actually' in content_disposition(name)
    assert ascii_fallback(name).endswith("[dmPQL84nv... (montage 6s-11s).mp4")
    # The same video downloaded here: title and label fit, nothing shortened, the id stays at the end.
    youtube = title.removesuffix(" [dmPQL84nv28]")
    assert build_download_name(youtube, "dmPQL84nv28", "mp4", label="(montage 6s-11s)") == (
        f"{youtube} (montage 6s-11s) [dmPQL84nv28].mp4")


def test_derived_name_respects_the_byte_budget_with_an_id() -> None:
    name = build_download_name("東" * 500, "abcdefghijk", "mp3", label="(audio 1m05s-1m20s, sped up ×1,25)")
    assert len(name.encode()) <= MAX_NAME_BYTES
    assert name.endswith("東… (audio 1m05s-1m20s, sped up ×1,25) [abcdefghijk].mp3")


def test_short_derived_names_and_plain_downloads_are_unchanged() -> None:
    assert build_download_name("Clip", "xyz", "mp4", label="(compressé)") == "Clip (compressé) [xyz].mp4"
    assert build_download_name(None, None, "gif", label="(GIF)") == "media (GIF).gif"
    fits = "a" * (MAX_TITLE_CHARS - len(" (GIF)"))
    assert build_download_name(fits, None, "gif", label="(GIF)") == f"{fits} (GIF).gif"
    assert build_download_name(fits + "b", None, "gif", label="(GIF)") == f"{'a' * (len(fits) - 1)}… (GIF).gif"
    # Without a label (downloads, imports): trimmed from the end as before, no "…".
    assert build_download_name("x" * 200, None, "mp4") == "x" * MAX_TITLE_CHARS + ".mp4"


def test_ascii_fallback() -> None:
    assert ascii_fallback("Café — 東京 [abc].mp4") == "Cafe [abc].mp4"
    assert ascii_fallback('quote"d;name.mp4') == "quote_d_name.mp4"
    assert ascii_fallback("東京 [abc].mp4") == "media [abc].mp4"
    assert ascii_fallback("東京.mp4") == "media.mp4"


def test_content_disposition_has_both_forms() -> None:
    header = content_disposition("Café 東京 [abc].mp4")
    assert header.startswith('attachment; filename="Cafe [abc].mp4"; filename*=UTF-8\'\'')
    encoded = header.split("filename*=UTF-8''", 1)[1]
    assert unquote(encoded) == "Café 東京 [abc].mp4"
    assert "\n" not in header and "\r" not in header
    header.encode("latin-1")  # must be a valid HTTP header value
