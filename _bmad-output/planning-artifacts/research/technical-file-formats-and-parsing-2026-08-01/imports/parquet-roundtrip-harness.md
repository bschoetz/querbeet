# Parquet round-trip harness — D5 (hyparquet-writer viability gate)

Date of run: 2026-08-01. All numbers in `parquet-measurements.txt` come from a **fresh re-run on 2026-08-01** of the
scripts below; the scripts themselves are **copied verbatim** from the still-existing working directory
(`$SCRATCH/pq`), not reconstructed from memory.

Provenance notes:

- Scripts (`gen.mjs`, `gz.mjs`, `entry-*.js`) — verbatim, read back off disk.
- Shell commands — verbatim as typed, except that the original invocations used `--silent` / `>/dev/null`
  redirections for noise suppression; those are kept here so the commands reproduce exactly.
- The `pip install` was **not** version-pinned at the time; the resolved versions are recorded below and
  pinned in the reproduction command so a later run gets the same tools.
- One cosmetic drift: the very first fflate bundle was built without `--platform=browser` and measured
  7,035 B / 3,569 B gzip; the pinned command below includes the flag and yields 7,036 B / 3,570 B. The
  measurements file records the flagged (current) numbers.

## 0. Environment

```
OS      Linux 7.1.5-arch1-2 x86_64 GNU/Linux (Arch Linux)
CPU     AMD Ryzen AI 9 365 w/ Radeon 880M
RAM     24,199,004 kB (~23 GiB)
Node    v26.5.0
npm     12.0.1
Python  3.14.6
esbuild 0.28.1
gzip    1.14-modified   (all gzip sizes measured at -9)

hyparquet         1.27.1
hyparquet-writer  0.16.3
fflate            0.8.3
apache-arrow      21.2.0
pyarrow           25.0.0
duckdb            1.5.5
polars            1.43.2
```

Note: these are **Node.js** timings, not browser timings. Same V8-family engine and the same pure-JS code
path (`hyparquet-writer` has no Node built-ins on its browser export), but a real Firefox 145 / Chrome 143
measurement has not been taken.

## 1. Setup

```sh
mkdir -p pq && cd pq
npm init -y
npm install --silent hyparquet-writer@0.16.3 hyparquet@1.27.1 esbuild@0.28.1
npm install --silent fflate@0.8.3
npm install --silent apache-arrow@21.2.0     # only to check whether Arrow JS has any Parquet support

python3 -m venv .venv
.venv/bin/pip -q install pyarrow==25.0.0 duckdb==1.5.5 polars==1.43.2
```

## 2. Bundle-size measurement (min + gzip)

Entry files, one line each:

```js
// entry-writer.js
export * from 'hyparquet-writer';
```

```js
// entry-reader.js
export * from 'hyparquet';
```

```js
// entry-both.js
export * from 'hyparquet-writer';
export * from 'hyparquet';
```

```js
// e-fflate.js
import {gzipSync} from 'fflate';export{gzipSync}
```

Build + measure loop (the `--minify` build is the number that matters; the second build gives the
unminified bundle size for reference):

```sh
for e in entry-writer entry-reader entry-both e-fflate; do
  ./node_modules/.bin/esbuild $e.js --bundle --minify --format=iife --global-name=PQ --platform=browser --outfile=$e.min.js
  ./node_modules/.bin/esbuild $e.js --bundle           --format=iife --global-name=PQ --platform=browser --outfile=$e.bundle.js
  echo "$e  min=$(stat -c%s $e.min.js)  gzip9=$(gzip -9 -c $e.min.js|wc -c)  unminified=$(stat -c%s $e.bundle.js)"
done
```

`--format=iife --global-name=PQ` is the single-HTML-file shape: the output is a self-contained script that
can be pasted between `<script>` tags with no module loader and no network fetch.

## 3. parquet-wasm payload measurement

```sh
# gzip as served over the wire by the CDN
curl -s -H "Accept-Encoding: gzip" -o w.gz -w "transfer(gzip)=%{size_download}\n" \
  "https://cdn.jsdelivr.net/npm/parquet-wasm@0.7.2/esm/parquet_wasm_bg.wasm"

# raw artefact, then local gzip -9 and base64-inline cost
curl -s -o w.raw  "https://cdn.jsdelivr.net/npm/parquet-wasm@0.7.2/esm/parquet_wasm_bg.wasm"
curl -s -o pw.js  "https://cdn.jsdelivr.net/npm/parquet-wasm@0.7.2/esm/parquet_wasm.js"
base64 -w0 w.raw > w.b64

stat -c%s w.raw ; gzip -9 -c w.raw | wc -c
stat -c%s w.b64 ; gzip -9 -c w.b64 | wc -c     # cost of inlining the wasm into the HTML file
stat -c%s pw.js ; gzip -9 -c pw.js | wc -c     # JS glue
```

Per-file sizes for the whole package were cross-checked against
`https://data.jsdelivr.com/v1/packages/npm/parquet-wasm@0.7.2`.

## 4. Dataset generation and Parquet writes — `gen.mjs`

100,000 rows × 5 columns: INT32, DOUBLE, STRING (variable length, 97-way repeating suffix so dictionary
encoding is exercised), TIMESTAMP, BOOLEAN with one third nulls.

```js
import { parquetWriteBuffer } from 'hyparquet-writer'
import { parquetReadObjects, parquetMetadata } from 'hyparquet'
import { writeFileSync } from 'fs'
const N = 100000
const id = new Int32Array(N), val = new Float64Array(N)
const name = new Array(N), when = new Array(N), flag = new Array(N)
for (let i=0;i<N;i++){ id[i]=i; val[i]=Math.sin(i)*1000; name[i]='row_'+i+'_'+(i%97); when[i]=new Date(1700000000000+i*1000); flag[i]= i%3===0 ? null : (i%2===0) }
const columnData=[{name:'id',data:id,type:'INT32'},{name:'value',data:val,type:'DOUBLE'},{name:'name',data:name,type:'STRING'},{name:'ts',data:when,type:'TIMESTAMP'},{name:'flag',data:flag,type:'BOOLEAN'}]
const mem0 = process.memoryUsage().heapUsed
const t0=performance.now()
const buf = parquetWriteBuffer({ columnData })
const t1=performance.now()
console.log('SNAPPY write 100k x5cols: ms=',(t1-t0).toFixed(0),'bytes=',buf.byteLength,'heapDelta MB=',((process.memoryUsage().heapUsed-mem0)/1048576).toFixed(1))
writeFileSync('test_snappy.parquet', Buffer.from(buf))
const t2=performance.now()
const buf2 = parquetWriteBuffer({ columnData, codec:'UNCOMPRESSED' })
console.log('UNCOMPRESSED write ms=',(performance.now()-t2).toFixed(0),'bytes=',buf2.byteLength)
writeFileSync('test_uncompressed.parquet', Buffer.from(buf2))
const t3=performance.now()
const rows = await parquetReadObjects({ file: buf })
console.log('hyparquet read-back ms=',(performance.now()-t3).toFixed(0),'rows=',rows.length,'first=',JSON.stringify(rows[0]))
console.log('createdBy=', parquetMetadata(buf).created_by)
```

Run: `node gen.mjs`

Note: `parquetWriteBuffer` with no `codec` option defaults to SNAPPY using the writer's own bundled pure-JS
Snappy — no extra dependency, no WASM.

## 5. GZIP-codec write via fflate — `gz.mjs`

Demonstrates that a non-default codec only needs a **synchronous** compressor function. 3 columns here
(no TIMESTAMP/BOOLEAN), so its output size is not comparable to the 5-column files.

```js
import { parquetWriteBuffer } from 'hyparquet-writer'
import { gzipSync } from 'fflate'
import { writeFileSync } from 'fs'
const N=100000
const id=new Int32Array(N), val=new Float64Array(N), name=new Array(N)
for(let i=0;i<N;i++){id[i]=i;val[i]=Math.sin(i)*1000;name[i]='row_'+i+'_'+(i%97)}
const columnData=[{name:'id',data:id,type:'INT32'},{name:'value',data:val,type:'DOUBLE'},{name:'name',data:name,type:'STRING'}]
const t=performance.now()
const buf=parquetWriteBuffer({columnData,codec:'GZIP',compressors:{GZIP:b=>gzipSync(b)}})
console.log('GZIP-codec write ms=',(performance.now()-t).toFixed(0),'bytes=',buf.byteLength)
writeFileSync('test_gzip.parquet',Buffer.from(buf))
EOF
```

Run: `node gz.mjs`

## 6. Interop check — pyarrow

```sh
.venv/bin/python -c "
import pyarrow, pyarrow.parquet as pq
t=pq.read_table('test_snappy.parquet')
print('pyarrow',pyarrow.__version__,'rows',t.num_rows)
print(t.schema)
print('flag null_count', t.column('flag').null_count)
print('first two rows:', t.slice(0,2).to_pydict())
print('uncompressed rows', pq.read_table('test_uncompressed.parquet').num_rows)
g=pq.ParquetFile('test_gzip.parquet')
print('gzip rows', g.metadata.num_rows, 'codec col0', g.metadata.row_group(0).column(0).compression, 'row_groups', g.metadata.num_row_groups)
print('snappy codec col0', pq.ParquetFile('test_snappy.parquet').metadata.row_group(0).column(0).compression, 'created_by', pq.ParquetFile('test_snappy.parquet').metadata.created_by)
"
```

## 7. Interop check — DuckDB

```sh
.venv/bin/python -c "
import duckdb
print('duckdb',duckdb.__version__)
print(duckdb.sql(\"...\").fetchall())
"
```

The three SQL statements, run against the files directly (DuckDB's Parquet reader, no import step):

```sql
select count(*) n, min(id) mn, max(id) mx, round(sum(value),3) s, count(flag) nonnull_flag
from 'test_snappy.parquet';

select * from 'test_uncompressed.parquet' limit 2;

select count(*), max(id) from 'test_gzip.parquet';
```

## 8. Interop check — Polars

```sh
.venv/bin/python -c "
import polars as pl
df=pl.read_parquet('test_snappy.parquet')
print('polars',pl.__version__,'shape',df.shape)
print('dtypes',dict(zip(df.columns,[str(d) for d in df.dtypes])))
print(df.head(2))
print('gzip file shape', pl.read_parquet('test_gzip.parquet').shape)
"
```

## 9. Arrow-JS Parquet check

```sh
npm install --silent apache-arrow@21.2.0
grep -ril "parquet" node_modules/apache-arrow/*.d.ts node_modules/apache-arrow/*.js   # → no matches
grep -c "parquet" node_modules/apache-arrow/Arrow.dom.d.ts                            # → 0
```

Raw output of the full re-run is in `parquet-measurements.txt`.
