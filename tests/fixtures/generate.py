# Fixture generator, Python half. Run it through `tests/fixtures/generate.mjs`,
# which knows which interpreter each mode needs and why.
#
#   python generate.py parquet <outdir>          needs pyarrow (a venv; see generate.mjs)
#   python generate.py protected-xlsx <outdir>   needs the system python that carries `uno`
#
# Neither tool is a project dependency. These files are generated once, committed,
# and read by the tests as bytes — the shapes below are exactly the ones
# `hyparquet-writer` and `write-excel-file` cannot produce, which is why real
# files exist for them at all.

import datetime
import decimal
import os
import shutil
import subprocess
import sys
import tempfile
import time


def parquet(out):
    """Three Parquet shapes hyparquet-writer cannot write. Produced with pyarrow 25.0.0."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    # 1. INT96 — the legacy timestamp Impala and older Spark still emit. pyarrow
    #    writes it only behind this deprecated flag; nothing in JS writes it.
    pq.write_table(
        pa.table(
            {
                "Erfasst": pa.array(
                    [
                        datetime.datetime(2025, 8, 1, 14, 30, 0),
                        None,
                        datetime.datetime(2024, 2, 29, 0, 0, 0),
                    ],
                    pa.timestamp("us"),
                ),
                "Kunde": pa.array(["Anna", "Bernd", "Clara"]),
            }
        ),
        os.path.join(out, "parquet-int96-timestamp.parquet"),
        use_deprecated_int96_timestamps=True,
        compression="snappy",
    )

    # 2. DECIMAL backed by FIXED_LEN_BYTE_ARRAY. The backing is chosen by
    #    precision: <= 9 gives INT32, <= 18 INT64, and beyond that a byte array.
    #    hyparquet-writer's DECIMAL path accepts only the two integer backings.
    pq.write_table(
        pa.table(
            {
                "Preis": pa.array(
                    [decimal.Decimal("1234567.89"), decimal.Decimal("-0.05"), None],
                    pa.decimal128(38, 2),
                )
            }
        ),
        os.path.join(out, "parquet-decimal-fixed-len-byte-array.parquet"),
        compression="snappy",
    )

    # 3. Two top-level columns of one name, with *different* physical types so a
    #    reader that mixes them up is caught by the values rather than only by a
    #    count. hyparquet-writer resolves columnData against the schema by name
    #    and cannot emit this at all.
    dup_schema = pa.schema([pa.field("Betrag", pa.int64()), pa.field("Betrag", pa.string())])
    pq.write_table(
        pa.Table.from_arrays(
            [pa.array([1, 2]), pa.array(["brutto", "netto"])], schema=dup_schema
        ),
        os.path.join(out, "parquet-duplicate-column-name.parquet"),
        compression="snappy",
    )


def protected_xlsx(out):
    """A genuinely password-protected workbook (password: geheim).

    LibreOffice's `--convert-to` filter options do **not** carry a password for
    xlsx — measured, every documented spelling produced a plain `PK\\x03\\x04`
    zip. The supported route is the UNO API, which is what this does: it starts
    soffice as a listener, loads a CSV and stores it with `Password` and
    `EncryptFile` in the media descriptor.

    The result is an OOXML-encrypted file, which is a CFB container beginning
    `D0 CF 11 E0` rather than a zip — that is what makes it a fixture worth
    having, since the whole question is what a reader does with a workbook it
    cannot open rather than one it can.
    """
    import uno
    from com.sun.star.beans import PropertyValue

    # Scratch space outside the fixture directory: nothing but the finished
    # workbook belongs next to the committed bytes.
    work = tempfile.mkdtemp(prefix="querbeet-fixture-")
    csv_path = os.path.join(work, "quelle.csv")
    with open(csv_path, "w", encoding="utf-8") as handle:
        handle.write("Kunde,Betrag\nAnna,1234.5\nBernd,80\n")

    profile = "file://" + os.path.join(work, "profile")
    soffice = subprocess.Popen(
        [
            "soffice",
            "--headless",
            "--norestore",
            "-env:UserInstallation=" + profile,
            "--accept=socket,host=127.0.0.1,port=2002;urp;",
        ]
    )
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext(
            "com.sun.star.bridge.UnoUrlResolver", local
        )
        ctx = None
        for _ in range(60):
            try:
                ctx = resolver.resolve(
                    "uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext"
                )
                break
            except Exception:
                time.sleep(1)
        if ctx is None:
            raise RuntimeError("no UNO bridge after 60s — is soffice installed?")

        def pv(name, value):
            prop = PropertyValue()
            prop.Name = name
            prop.Value = value
            return prop

        desktop = ctx.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", ctx
        )
        doc = desktop.loadComponentFromURL(
            "file://" + csv_path,
            "_blank",
            0,
            (
                pv("Hidden", True),
                pv("FilterName", "Text - txt - csv (StarCalc)"),
                pv("FilterOptions", "44,34,76,1"),
            ),
        )
        doc.storeToURL(
            "file://" + os.path.join(out, "xlsx-password-protected.xlsx"),
            (
                pv("FilterName", "Calc MS Excel 2007 XML"),
                pv("Password", "geheim"),
                pv("EncryptFile", True),
            ),
        )
        doc.close(False)
        desktop.terminate()
    finally:
        soffice.wait(timeout=30)
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    mode, out = sys.argv[1], sys.argv[2]
    {"parquet": parquet, "protected-xlsx": protected_xlsx}[mode](out)
    print(f"generate.py {mode}: done")
