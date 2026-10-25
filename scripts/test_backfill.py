"""Fast offline smoke tests for the PDF archive importer."""
import fitz
from backfill_archive import candidates, iso_date, read_pdf

assert iso_date("Torsdag den 10. oktober 2024") == "2024-10-10"
assert iso_date("32. oktober 2024") is None
assert iso_date("Ingen dato") is None

pdf = fitz.open()
page = pdf.new_page(width=620, height=840)
page.insert_text((20, 26), "Folketinget fredag den 8. november 2024")
page.insert_text((20, 66), "Kl. 12:00")
page.insert_text((20, 90), "Formanden (Soren Gade):")
page.insert_text((20, 110), "Modet er abnet. Dette er en prove.")
page.insert_text((330, 65), "Kl. 12:05")
page.insert_text((330, 90), "Anders Kronborg (S):")
page.insert_text((330, 110), "Dette er en ekstra tale om frokost.")
source = pdf.tobytes()
pdf.close()

date, speeches = read_pdf(source, "20241")
assert date == "2024-11-08"
assert len(speeches) == 2
assert [x["clock"] for x in speeches] == ["12:00", "12:05"]
assert [x["speaker"] for x in speeches] == ["Formanden (Soren Gade)", "Anders Kronborg (S)"]
try:
    read_pdf(source, "20211")
except ValueError:
    pass
else:
    raise AssertionError("Cross-session date validation did not fail")

todo = list(candidates([{"samling": "20261", "meeting_no": 9}]))
assert todo[0] == ("20261", 10)
assert ("20231", 1) in todo
print("Archive backfill smoke tests passed.")
