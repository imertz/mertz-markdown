# Introduction (/docs/zbsearch)



ZBSearch (*zee bee search*) is a zero-bs fork of Orama maintained by **the original Orama team**. After [Michele's departure](https://www.micheleriva.dev/writings/my-last-day-at-orama), the entire engineering team left Orama and reassembled to maintain this popular project with no external influence. No VC, no business incentives, no bs. Just open source software.

ZBSearch is an <a href="https://github.com/micheleriva/zbsearch" target="_blank">open source</a>, high performance full-text and vector search engine entirely written in TypeScript, with zero dependencies.

## Performance vs Orama [#performance-vs-orama]

ZBSearch is a drop-in fork of Orama with the same API and persistence format, but with heavily optimized internals - including explicit **postings lists** for the full-text inverted index. We benchmark both engines head-to-head in the [`benchmarks/`](https://github.com/micheleriva/zbsearch/tree/main/benchmarks) suite (Orama **3.1.18** vs ZBSearch **3.3.1**, July 2026). The headline: &#x2A;*ZBSearch is faster on almost every query path, with lower memory use and a smaller on-disk bundle.** Full results are on the [ZBSearch vs Orama](/docs/zbsearch/vs-orama) page.

| Area                     | ZBSearch vs Orama       | Highlight                                                      |
| ------------------------ | ----------------------- | -------------------------------------------------------------- |
| **Indexing**             | **\~42–44% faster**     | **33 ops/s** full-dataset insert vs 19                         |
| **Full-text search**     | **11–58% faster**       | Up to **12,415 ops/s** on long-text + complex filters vs 5,252 |
| **Facets**               | **28–56% faster**       | Faster across every facet scenario tested                      |
| **Vector search (flat)** | **16–52% faster**       | **6,889 ops/s** strict similarity vs 4,532                     |
| **Vector search (IVF)**  | **\~350–1,270% faster** | **30,530 ops/s** vector search - Orama has no IVF equivalent   |
| **Geosearch**            | **\~8,400% faster**     | **308,894 ops/s** on 500m radius vs 3,649                      |
| **Sorted indexes (AVL)** | **12–54% faster**       | **54% faster** on narrow range search; \~equal on comparisons  |
| **Memory footprint**     | **6–8% lower**          | **15.69 MB** indexed heap delta vs 17.12 MB                    |
| **Persistence**          | **4–7% smaller**        | **5.51 MB** serialized JSON vs 5.72 MB                         |

## Requirements [#requirements]

A JavaScript runtime is the **only** requirement. ZBSearch has been designed to work on any JS runtime and has no dependencies.

## Installation [#installation]

You can install ZBSearch using any JavaScript package manager of your choice.

```bash
npm i zbsearch
```

Or import it directly in a browser module:

```html
<html>
  <body>
    <script type="module">
      import {
        create,
        search,
        insert,
      } from "https://cdn.jsdelivr.net/npm/zbsearch@latest/+esm";

      // ...
    </script>
  </body>
</html>
```

## Basic usage [#basic-usage]

```ts copy
import { create, search, insert } from "zbsearch";

// Create a new ZBSearch instance
const db = create({
  schema: {
    name: "string",
    description: "string",
    price: "number",
    meta: {
      rating: "number",
    },
  },
});

// Insert documents into the database
insert(db, {
  name: "Wireless Headphones",
  description: "Experience immersive sound quality with these noise-cancelling wireless headphones.",
  price: 99.99,
  meta: {
    rating: 4.5,
  },
});

// Search for documents
const searchResult = search(db, {
  term: "headphones",
});

console.log(searchResult.hits.map((hit) => hit.document));
```

For more information, check out the [Usage](/docs/zbsearch/usage/create) section.

## CommonJS Imports [#commonjs-imports]

ZBSearch ships **ESM** modules by default. This allows us to move faster when providing new features and bug fixes, as well as using the `"exports"` field in `package.json` to provide a better developer experience.

CommonJS imports are still supported, but we suggest you to migrate to ESM.

## TypeScript [#typescript]

Set `moduleResolution` in the `compilerOptions` in your `tsconfig.json` to be either `Node16` or `NodeNext`.

When importing types, always refer to the standard zbsearch import:

```ts copy
import type { Language } from "zbsearch";
```
# Create a new ZBSearch instance (/docs/zbsearch/usage/create)



We can create a new instance (from now on database) with an &#x2A;*indexing `schema`**.<br />
The schema represents **the searchable properties** of the document to be inserted.
Not all properties need to be indexed, but only those that we want to be able to search for.

If you want to learn more and see real-world examples, check out <a href="https://orama.com/blog/optimizing-orama-schema-optimization" target="_blank">this blog post</a> we wrote about schema optimization.

## Schema properties and types [#schema-properties-and-types]

The `schema` is an object where the keys are the property names and the values are the property types. \
ZBSearch supports the following types:

| Type             | Description                                      | Example                           |
| ---------------- | ------------------------------------------------ | --------------------------------- |
| `string`         | A string of characters.                          | `'Hello world'`                   |
| `number`         | A numeric value, either float or integer.        | `42`                              |
| `boolean`        | A boolean value.                                 | `true`                            |
| `enum`           | An enum value.                                   | `'drama'`                         |
| `geopoint`       | A geopoint value.                                | `{ lat: 40.7128, lon: 74.0060 }`  |
| `string[]`       | An array of strings.                             | `['red', 'green', 'blue']`        |
| `number[]`       | An array of numbers.                             | `[42, 91, 28.5]`                  |
| `boolean[]`      | An array of booleans.                            | `[true, false, false]`            |
| `enum[]`         | An array of enums.                               | `['comedy', 'action', 'romance']` |
| `vector[<size>]` | A vector of numbers to perform vector search on. | `[0.403, 0.192, 0.830]`           |

A database can be as simple as:

```javascript copy
import { create } from "zbsearch";

const db = create({
  schema: {
    word: "string",
  },
});
```

or more variegated:

```javascript copy
import { create } from "zbsearch";

const movieDB = create({
  schema: {
    title: "string",
    director: "string",
    plot: "string",
    year: "number",
    isFavorite: "boolean",
  },
});
```

## Schema-less usage (schema inference) [#schema-less-usage-schema-inference]

The `schema` is **optional**. If you omit it, ZBSearch infers the type of every document property the first time it sees it, and indexes it on the fly:

```javascript copy
import { create, insert, search } from "zbsearch";

const db = create();

await insert(db, { title: "The Godfather", year: 1972, cast: { director: "Coppola" } });

// db.schema is now: { title: "string", year: "number", cast: { director: "string" } }
await search(db, { term: "godfather" });
```

Inferred types follow these rules:

| Document value                        | Inferred type                             |
| ------------------------------------- | ----------------------------------------- |
| `string`                              | `string`                                  |
| `number`                              | `number`                                  |
| `boolean`                             | `boolean`                                 |
| `string[]` / `number[]` / `boolean[]` | `string[]` / `number[]` / `boolean[]`     |
| `{ lat: number, lon: number }`        | `geopoint`                                |
| nested object                         | recursively inferred as nested properties |
| empty array, `null`, `undefined`      | deferred until a concrete value appears   |

A few things worth knowing:

* **Types lock on first sight.** If `year` is first seen as a `number`, a later document with `year: "1972"` is rejected with a `SCHEMA_VALIDATION_FAILURE` error, exactly as with a declared schema.
* **Vectors are never inferred**, because a `number[]` is indistinguishable from an embedding. Declare vector (embedding) properties explicitly and let everything else be inferred:

```javascript copy
const db = create({
  schema: { embedding: "vector[384]" },
  inferSchema: true, // required: a provided schema is strict by default
});
```

* **Providing a schema keeps the strict behavior**: properties not declared in the schema are stored but not indexed, unless you opt into inference with `inferSchema: true` as above. Conversely, `create({ inferSchema: false })` stores documents without indexing anything.
* Inferred schemas are preserved by `save`/`load`, so schema-less databases survive persistence round-trips.

## Nested properties [#nested-properties]

ZBSearch supports nested properties natively. Just add them as you would typically do in any JavaScript object:

```javascript copy
const movieDB = create({
  schema: {
    title: "string",
    plot: "string",
    cast: {
      director: "string",
      leading: "string",
      supporting: "string[]",
    },
    year: "number",
    isFavorite: "boolean",
  },
});

insert(movieDB, {
  title: "The Godfather",
  plot: "The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant son.",
  cast: {
    director: "Francis Ford Coppola",
    leading: "Marlon Brando",
    supporting: ["Al Pacino", "James Caan", "Robert Duvall"],
  },
  year: 1972,
  isFavorite: true,
});
```

## Vector properties [#vector-properties]

Since version `1.2.0`, ZBSearch supports vector search. \
To run vector queries, you first need to initialize a vector property in the schema:

```javascript copy
const db = create({
  schema: {
    title: "string",
    embedding: "vector[10]", // replace 10 with the appropriate size of your vector
  },
});

insert(db, {
  title: "The Godfather",
  embedding: [
    -0.8469661901208547, 0.6762289692745016, 0.3294302068627739,
    -0.9269241187762711, -0.8340635986042049, -0.9940330715457502,
    -0.46761552816396046, 0.2818135926099674, -0.5812061227183709,
    0.6443446315273054,
  ],
});
```

Please note that the size of the vector **must** be specified in the schema. \
The size of the vector is the number of elements that the vector contains, so make sure to specify the correct size, as performing search on vectors of different sizes will result in unpredictable and mostly wrong results.
For performance reasons, we recommend using one vector property per database, even though it's possible to have multiple vector properties in the same ZBSearch instance.

If you're using vector properties to search through embeddings, we highly recommend using [HuggingFace's](https://huggingface.co/) `gte-small` model, which has a vector size of `384`.

There is a great article written by Supabase explaining why it might be a better option than OpenAI's `text-embedding-ada-002` model: [https://supabase.com/blog/fewer-dimensions-are-better-pgvector](https://supabase.com/blog/fewer-dimensions-are-better-pgvector).

### Choosing an IVF index [#choosing-an-ivf-index]

By default, ZBSearch uses a **flat** vector index: every query compares your search vector against all stored embeddings. That is simple, exact, and ideal for small or medium datasets (roughly up to a few thousand vectors), prototypes, and cases where recall must be perfect.

For larger collections, switch to an **IVF** (Inverted File) index. IVF partitions vectors into clusters at insert time and only searches a subset of clusters at query time, trading a small amount of recall for much faster searches. Enable it when vector search latency grows with your dataset size and you can tolerate approximate nearest-neighbor results.

```javascript copy
import { create } from "zbsearch";
import { ivf } from "zbsearch/trees/vector-ivf";

const db = create({
  schema: {
    title: "string",
    embedding: "vector[384]",
  },
  indexes: {
    embedding: ivf({
      nlist: 64,    // number of clusters (default: 64)
      nprobe: 16,   // clusters searched per query (default: nlist / 4, capped at 32)
      trainMin: 32, // minimum vectors before training centroids (default: min(nlist, 32))
    }),
  },
});
```

**Pros:** significantly faster vector search on large indexes, lower per-query CPU cost, and configurable speed/recall via `nprobe` (higher `nprobe` = more accurate but slower).

**Cons:** results are approximate-you may miss the true nearest neighbor-centroids must be trained once enough vectors are inserted (`trainMin`), tuning `nlist` and `nprobe` takes experimentation, and persistence requires passing the same `indexes` config when loading a saved database. Start with flat search; reach for IVF when profiling shows vector queries are a bottleneck.

## Instance ID [#instance-id]

Every ZBSearch instance has a unique `id` property, which can be used to identify a given instance when working with multiple databases.

You can customize it by passing an `id` property during the creation of the instance:

```javascript copy
import { create } from "zbsearch";

const db = create({
  schema: {
    word: "string",
  },
  id: "my-orama-instance",
});
```
# Insert Data (/docs/zbsearch/usage/insert)



Whenever we create a database with ZBSearch, we must specify a `schema`, which
represents the entry we are going to index.

Let's say our database and schema look like this:

```javascript copy
import { create, insert } from "zbsearch";

const movieDB = create({
  schema: {
    title: "string",
    director: "string",
    plot: "string",
    year: "number",
    isFavorite: "boolean",
  },
});
```

(Read more about database creation on the [create](/docs/zbsearch/usage/create) page)

## Insert [#insert]

Data insertion in ZBSearch is quick and intuitive:

```javascript copy
const thePrestigeId = insert(movieDB, {
  title: "The prestige",
  director: "Christopher Nolan",
  plot: "Two friends and fellow magicians become bitter enemies after a sudden tragedy. As they devote themselves to this rivalry, they make sacrifices that bring them fame but with terrible consequences.",
  year: 2006,
  isFavorite: true,
});

const bigFishId = insert(movieDB, {
  title: "Big Fish",
  director: "Tim Burton",
  plot: "Will Bloom returns home to care for his dying father, who had a penchant for telling unbelievable stories. After he passes away, Will tries to find out if his tales were really true.",
  year: 2004,
  isFavorite: true,
});

const harryPotterId = insert(movieDB, {
  title: "Harry Potter and the Philosopher's Stone",
  director: "Chris Columbus",
  plot: "Harry Potter, an eleven-year-old orphan, discovers that he is a wizard and is invited to study at Hogwarts. Even as he escapes a dreary life and enters a world of magic, he finds trouble awaiting him.",
  year: 2001,
  isFavorite: false,
});
```

If you have a lot of records, we suggest using the `insertMultiple` function as following:

```javascript copy
const docs = [
  {
    title: "The prestige",
    director: "Christopher Nolan",
    plot: "Two friends and fellow magicians become bitter enemies after a sudden tragedy. As they devote themselves to this rivalry, they make sacrifices that bring them fame but with terrible consequences.",
    year: 2006,
    isFavorite: true,
  },
  {
    title: "Big Fish",
    director: "Tim Burton",
    plot: "Will Bloom returns home to care for his dying father, who had a penchant for telling unbelievable stories. After he passes away, Will tries to find out if his tales were really true.",
    year: 2004,
    isFavorite: true,
  },
  {
    title: "Harry Potter and the Philosopher's Stone",
    director: "Chris Columbus",
    plot: "Harry Potter, an eleven-year-old orphan, discovers that he is a wizard and is invited to study at Hogwarts. Even as he escapes a dreary life and enters a world of magic, he finds trouble awaiting him.",
    year: 2001,
    isFavorite: false,
  },
];

insertMultiple(movieDB, docs);
```

Inserting a large number of documents in a loop could potentially block the event loop.
Instead `insertMultiple` handles this case better.

You can pass a third, optional, parameter to change the batch size (default:
`1000`). We recommend keeping this number as low as possible to avoid blocking
the event loop. The `batchSize` refers to the maximum number of `insert`
operations to perform before yielding the event loop.

```javascript
insertMultiple(movieDB, docs, 500);
```

## Validation rules [#validation-rules]

Defining the schema at database creation time, ZBSearch validates all the inserted documents following those rules:

* throw an error if a field has an unexpected type
* allow missing fields or fields set to `undefined`
* allow extra fields ignoring them

So the following document will be accepted:

```javascript copy
import { create, insert } from "zbsearch";

const movieDB = create({
  schema: {
    title: "string",
    year: "number",
  },
});

insert(movieDB, {
  title: "The prestige",
  // `year` field is missing but it's ok
  // year: 2006,
  // Extra fields `director` and `isFavorite` will not be indexed
  director: "Christopher Nolan",
  isFavorite: true,
});
```

## Custom document IDs [#custom-document-ids]

<Callout>
  If the `id` field is not found, ZBSearch will generate a random `id` for the document.
  To provide a custom ID for a document, see the [components](/docs/zbsearch/internals/components) page.
</Callout>

ZBSearch automatically uses the `id` field of the document, if found.

That means that given the following document and schema:

```js
import { create, search } from "zbsearch";

const db = create({
  schema: {
    id: "string",
    author: "string",
    quote: "string",
  },
});

insert(db, {
  id: "73cbcc79-2203-49b8-bb52-60d8e9a66c5f",
  author: "Fernando Pessoa",
  quote: "I wasn't meant for reality, but life came and found me",
});
```

the document will be indexed with the following `id`: `73cbcc79-2203-49b8-bb52-60d8e9a66c5f`.

<Callout type="warn">
  **Beware** <br />
  If you try to insert two documents with the same ID, ZBSearch will throw an error.
</Callout>

## Remote document storing [#remote-document-storing]

By default ZBSearch keeps a copy of the inserted document in memory (and in the serialized data) to speed up search performance.

If this is not acceptable, you can provide a custom `documentsStore` component which will be responsible to store
and fetch documents from another location (local or remote).

The code example below is an example that implements a proxy: when a document is requested, the code finds it on a location of the filesystem.
We assume each document has an `id` field which disable ZBSearch random ID generation.

You can replace the file related operations with your custom code.

```javascript copy
import { readFile, readdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { create } from "zbsearch";

const ROOT_LOCATION = "/var/db/orama-example";

async function getDocument(id) {
  return JSON.parse(
    await readFile(resolve(ROOT_LOCATION, `${id}.json`), "utf-8")
  );
}

async function listDocuments() {
  const allFiles = await readdir(ROOT_LOCATION);

  return allFiles.filter((id) => id.endsWith(".json"));
}

const database = create({
  schema: {
    title: "string",
    director: "string",
  },
  components: {
    // override partially the default documents store
    documentsStore: {
      create() {
        return {};
      },
      load(raw) {
        return {};
      },
      save(store) {
        return {};
      },
      get(_, id) {
        return getDocument(id);
      },
      getMultiple(_, ids) {
        return Promise.all(
          ids.map(async (id) => {
            return JSON.parse(await getDocument(id));
          })
        );
      },
      async getAll() {
        const docs = await listDocuments();

        return Promise.all(
          docs.map(async (id) => {
            return JSON.parse(await getDocument(id));
          })
        );
      },
      store() {
        // No-op
      },
      remove() {
        // No-op
      },
      async count() {
        const docs = await listDocuments();

        return docs.count;
      },
    },
  },
});
```
# Remove data (/docs/zbsearch/usage/remove)



Removal is one of the easiest things to do in ZBSearch. Let's say we have the
following database with the following inserted documents:

```javascript copy
import { create, insert, remove, search } from "zbsearch";

const movieDB = create({
  schema: {
    title: "string",
    director: "string",
    plot: "string",
    year: "number",
    isFavorite: "boolean",
  },
});

const thePrestigeId = insert(movieDB, {
  title: "The prestige",
  director: "Christopher Nolan",
  plot: "Two friends and fellow magicians become bitter enemies after a sudden tragedy. As they devote themselves to this rivalry, they make sacrifices that bring them fame but with terrible consequences.",
  year: 2006,
  isFavorite: true,
});

const bigFishId = insert(movieDB, {
  title: "Big Fish",
  director: "Tim Burton",
  plot: "Will Bloom returns home to care for his dying father, who had a penchant for telling unbelievable stories. After he passes away, Will tries to find out if his tales were really true.",
  year: 2004,
  isFavorite: true,
});

const harryPotterId = insert(movieDB, {
  title: "Harry Potter and the Philosopher's Stone",
  director: "Chris Columbus",
  plot: "Harry Potter, an eleven-year-old orphan, discovers that he is a wizard and is invited to study at Hogwarts. Even as he escapes a dreary life and enters a world of magic, he finds trouble awaiting him.",
  year: 2001,
  isFavorite: false,
});
```

To remove a single document from the database we use the:

```javascript copy
remove(movieDB, harryPotterId);
```

As simple as that.

## Batch removal [#batch-removal]

Most of the `remove` function internals are synchronous, so removing a large
number of documents in a loop could potentially block the event loop. If you
have a lot of records, we suggest using the `removeMultiple` function.

You can pass a third, optional, parameter to change the batch size (default:
`1000`). We recommend keeping this number as low as possible to avoid blocking
the event loop. The `batchSize` refers to the maximum number of `remove`
operations to perform before yielding the event loop.

```javascript copy
const docs = [
  {
    title: "The prestige",
    director: "Christopher Nolan",
    plot: "Two friends and fellow magicians become bitter enemies after a sudden tragedy. As they devote themselves to this rivalry, they make sacrifices that bring them fame but with terrible consequences.",
    year: 2006,
    isFavorite: true,
  },
  {
    title: "Big Fish",
    director: "Tim Burton",
    plot: "Will Bloom returns home to care for his dying father, who had a penchant for telling unbelievable stories. After he passes away, Will tries to find out if his tales were really true.",
    year: 2004,
    isFavorite: true,
  },
  {
    title: "Harry Potter and the Philosopher's Stone",
    director: "Chris Columbus",
    plot: "Harry Potter, an eleven-year-old orphan, discovers that he is a wizard and is invited to study at Hogwarts. Even as he escapes a dreary life and enters a world of magic, he finds trouble awaiting him.",
    year: 2001,
    isFavorite: false,
  },
];

const ids = insertMultiple(movieDB, docs, 500);
removeMultiple(movieDB, ids, 500);
```

The function returns the number of the removed documents.
# Update data (/docs/zbsearch/usage/update)



ZBSearch is optimized to be immutable. Rather than trying to update a document in the database, we suggest you to create the database from scratch.

People that know what they are doing can use the `update` or `updateMultiple` methods, which are just aliases for `remove`/`removeMultiple` followed by a `insert`/`insertMultiple`.
# Utility functions for ZBSearch (/docs/zbsearch/usage/utilities)



ZBSearch exposes a few utility functions that can be useful when working with the search results.

## `getByID` [#getbyid]

`getByID` is a function that allows you to retrieve a document from a ZBSearch database by its ID.

```javascript copy
import { getByID } from "zbsearch";

const thePrestige = await getByID(movieDB, "tt0482571");

// Returns the original, full document
```

## `count` [#count]

`count` is a function that allows you to retrieve the number of documents in a ZBSearch database.

```javascript copy
import { count } from "zbsearch";

const docNumber = await count(movieDB);

// Returns the number of documents in the database
```

# Introduction to search (/docs/zbsearch/search)



ZBSearch provides a simple search interface that allows you to search through your documents. With a unique API, you can perform **full-text**, **vector**, and **hybrid** search.

## Searching with ZBSearch [#searching-with-zbsearch]

By default, ZBSearch uses all the string properties to perform the search.
Let's say we have a database that contains some elements:

```javascript copy
import { create, insert, search } from "zbsearch";

const movieDB = create({
  schema: {
    title: "string",
    director: "string",
    plot: "string",
    year: "number",
    isFavorite: "boolean",
  },
});

insert(movieDB, {
  title: "The prestige",
  director: "Christopher Nolan",
  plot: "Two friends and fellow magicians become bitter enemies after a sudden tragedy. As they devote themselves to this rivalry, they make sacrifices that bring them fame but with terrible consequences.",
  year: 2006,
  isFavorite: true,
});

insert(movieDB, {
  title: "Big Fish",
  director: "Tim Burton",
  plot: "Will Bloom returns home to care for his dying father, who had a penchant for telling unbelievable stories. After he passes away, Will tries to find out if his tales were really true.",
  year: 2004,
  isFavorite: true,
});

insert(movieDB, {
  title: "Harry Potter and the Philosopher's Stone",
  director: "Chris Columbus",
  plot: "Harry Potter, an eleven-year-old orphan, discovers that he is a wizard and is invited to study at Hogwarts. Even as he escapes a dreary life and enters a world of magic, he finds trouble awaiting him.",
  year: 2001,
  isFavorite: false,
});
```

We can now search for documents as easily as:

```javascript copy
const searchResult = search(movieDB, {
  term: "Harry",
});
```

If you want to return all documents in the database, then you can omit the `term` in the search parameters.

## What does the `search` method return? [#what-does-the-search-method-return]

Now that we have learned how to perform **searches** on a ZBSearch database, we can
briefly analyze the response that ZBSearch gives us back.

Let's say we have run the following query:

```javascript copy
const searchResult = search(movieDB, {
  term: "Cris",
  properties: ["director"],
  tolerance: 1,
});
```

Whether the document was found or not, ZBSearch gives back an `object` with the
following properties:

```javascript copy
{
  elapsed: {
    raw: 181208,
    formatted: '181μs',
  },
  count: 2,
  hits: [
    {
      id: '37149225-243',
      score: 0.23856062735983122,
      document: {
        title: 'Harry Potter and the Philosopher\'s Stone',
        director: 'Chris Columbus',
        plot: 'Harry Potter, an eleven-year-old orphan, discovers that he is a wizard and is invited to study at Hogwarts. Even as he escapes a dreary life and enters a world of magic, he finds trouble awaiting him.',
        year: 2001,
        isFavorite: false
      }
    },
    {
      id: '37149225-5',
      score: 0.21267890323564321,
      document: {
        title: 'The prestige',
        director: 'Christopher Nolan',
        plot: 'Two friends and fellow magicians become bitter enemies after a sudden tragedy. As they devote themselves to this rivalry, they make sacrifices that bring them fame but with terrible consequences.',
        year: 2006,
        isFavorite: true
      }
    }
  ]
}
```

| Property  | Type     | Description                                                                                                                    |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `elapsed` | `object` | Time taken to execute the query. <br /> Returns an object with the following shape: <br />`{ raw: number, formatted: string }` |
| `hits`    | `object` | Array of results containing result score (from `0` to `1` based on relevance), ZBSearch's ID, and original document.           |
| `count`   | `number` | Number of total results.                                                                                                       |

In case of missing or empty `term`, all scores will be returned as `0`.

## Search on specific properties [#search-on-specific-properties]

The `properties` property defines in which properties to run our query.

```javascript copy
const searchResult = search(movieDB, {
  term: "Chris",
  properties: ["director"],
});
```

We are now searching for all the documents that contain the word `Chris` in the
`director` property.

We can also search through nested properties:

```javascript copy
const searchResult = search(movieDB, {
  term: "Chris",
  properties: ["cast.director"],
});
```

By default, ZBSearch searches in **all** searchable properties.

## Exact match [#exact-match]

The `exact` property finds all the document with an exact match of the `term`
property.

```javascript copy
const searchResult = search(movieDB, {
  term: "Chris",
  properties: ["director"],
  exact: true,
});
```

We are now searching for all the documents that contain &#x2A;*`exactly`** the word
`Chris` in the `director` property.

Without the `exact` property, for example, the term `Christopher Nolan` would be returned as well, as it contains the word `Chris`.

<Callout type="warn">
  `exact` doesn't work together with the `tolerance` parameter. `exact` will have priority.
</Callout>

## Typo tolerance [#typo-tolerance]

The `tolerance` property allows specifying the maximum distance (following the
Levenshtein algorithm) between the term and the searchable property.

> *The Levenshtein distance is a string metric for measuring the difference
> between two sequences. Informally, the Levenshtein distance between two words
> is the minimum number of single-character edits (insertions, deletions or
> substitutions) required to change one word into the other.* ([read more](https://orama.com/blog/typo-no-more-an-in-depths-guide-to-the-levenshtein-edit-distance))

```javascript copy
const searchResult = search(movieDB, {
  term: "Cris",
  properties: ["director"],
  tolerance: 1,
});
```

We are searching for all the documents that contain a term with an edit distance
of `1` (e.g. `Chris`) in the `director` property.

<Callout type="warn">
  `tolerance` doesn't work together with the `exact` parameter. `exact` will have priority.
</Callout>

## Results limits [#results-limits]

The `limit` property limits the result at the specified number.

```javascript copy
const searchResult = search(movieDB, {
  term: "Chris",
  properties: ["director"],
  limit: 1,
});
```

We are searching for the `first` document that contains the term `Chris` in the
`director` property.

## Results offset [#results-offset]

The `offset` property skips the first `X` results.

```javascript copy
const searchResult = search(movieDB, {
  term: "Chris",
  properties: ["director"],
  offset: 1,
});
```

We are searching for all the documents that contain the term `Chris` in the
`director` property, but returning the document at offset `1`.

<Callout>
  **Remember!**<br />
  By default, ZBSearch limits the search results to `10`, without any offset (so, `0` as offset value).
</Callout>

## Distinct [#distinct]

ZBSearch can calculate distinct values letting you specify a unique key as follows:

```javascript copy
const results = search(db, {
  distinctOn: "type",
  sortBy: {
    property: "rank",
    order: "DESC",
  },
});
```

Using the property `distinctOn`, ZBSearch returns only the first document for every property `type` value.
The `results.hits` array will contain only the first documents for every property `type` value.

NB: you can use this feature in combination with `sortBy`.

## `elapsed` property customization [#elapsed-property-customization]

You can always customize the behavior of the `elapsed` property by using the `formatElapsedTime` component when creating a new ZBSearch instance:

```javascript copy
const db = create({
  schema: {
    title: "string",
    body: "string",
  },
  components: {
    formatElapsedTime: (n: bigint) => {
      return `custom value: ${n}`;
    },
  },
});
```

When performing a search operation, the `elapsed` property will now return the following value:

```javascript copy
{
  elapsed: 'custom value: 181208', // instead of { raw: 181208, formatted: '181μs' }
  count: 2,
  hits: [...]
}
```

## Caveats [#caveats]

Search is **not** case sensitive.
# Changing Default Search Algorithm (/docs/zbsearch/search/changing-default-search-algorithm)



ZBSearch defaults to **BM25**. You can swap it for **QPS** (Quantum Proximity Scoring) or **PT15** (Positional Token 15) with a plugin:

```js
import { create } from 'zbsearch'
import { pluginQPS } from '@zbsearch/plugin-qps'
import { pluginPT15 } from '@zbsearch/plugin-pt15'

const db = create({
  schema: {
    title: 'string',
    description: 'string',
    rating: 'number',
  },
  plugins: [
    pluginQPS() // or pluginPT15()
  ],
})
```

## Comparison [#comparison]

|           | BM25                             | QPS                               | PT15                              |
| --------- | -------------------------------- | --------------------------------- | --------------------------------- |
| Focus     | Term frequency + document length | Token proximity                   | Token position                    |
| Best for  | General-purpose search           | Queries where nearby terms matter | Titles, structured text, prefixes |
| Trade-off | Ignores proximity                | More ranking overhead             | Fixed 15 position buckets         |

**BM25** is the industry-standard default - solid for most workloads.

**QPS** scores documents by how close matching tokens are, which helps with short, focused queries and browser/edge environments.

**PT15**, inspired by [Thomas Wilkerling](https://github.com/ts-thomas)'s work on Flexsearch, stores tokens in 15 positional buckets and prefers matches that appear earlier in a document. It is typically the fastest of the three at search time.

## Benchmarks [#benchmarks]

Same 1,512-document dataset, **ZBSearch 3.3.1** (`npm run benchmark:algorithms`). Higher ops/s is better.

| Benchmark                   |   BM25 |    QPS |       PT15 |
| --------------------------- | -----: | -----: | ---------: |
| Insert multiple             | **32** |     19 |         16 |
| Plain search                | 83,505 | 59,276 | **87,437** |
| Search with filters         | 33,336 | 36,663 | **47,266** |
| Long text + complex filters | 18,168 | 18,325 | **24,211** |
| Single-term prefix          |  3,161 |  4,271 |  **9,020** |

BM25 indexes fastest (\~&#x2A;*1.7–2×** QPS/PT15). **PT15** wins every search case here (about &#x2A;*2.9×** BM25 on prefixes). **QPS** trades some throughput for proximity-aware ranking.

## How to choose [#how-to-choose]

* Stick with **BM25** unless you have a reason to change.
* Try **QPS** when proximity (e.g. `"machine learning"` vs `"learning machine"`) matters for relevance.
* Try **PT15** when you want position-aware ranking and maximum search throughput.

Test each algorithm on your own dataset and queries before committing.
# Fields Boosting (/docs/zbsearch/search/fields-boosting)



You can use the `boost` interface to boost the importance of a field in the search results.

```javascript copy
const searchResult = search(movieDB, {
  term: "Harry",
  properties: "*",
  boost: {
    title: 2,
  },
});
```

In this example, we are boosting the `title` field by `2`.

That means that any match of `'Harry'` in the `title` field will be considered twice as important as a match in any other field.

You can boost multiple fields:

```javascript copy
const searchResult = search(movieDB, {
  term: "Harry",
  properties: "*",
  boost: {
    title: 2,
    director: 1.5,
  },
});
```

In this example, we are boosting the `title` field by `2` and the `director` field by `1.5`.
# Facets (/docs/zbsearch/search/facets)



Facets are a powerful tool for filtering and narrowing down search results on the ZBSearch search engine.

With the ZBSearch Faceted Search API, users can filter their search results by various criteria, such as category, price range, or other attributes, making it easier to find the information they need. Whether you're building a website, mobile app, or any other application, the ZBSearch Faceted Search API is the perfect solution for adding faceted search functionality to your project.

Given the following ZBSearch schema:

```js
import { create } from "zbsearch";

const db = create({
  schema: {
    title: "string",
    description: "string",
    categories: {
      primary: "string",
      secondary: "string",
    },
    rating: "number",
    isFavorite: "boolean",
  },
});
```

ZBSearch will be able to generate facets at search-time based on the schema.
To do so, we need to specify the `facets` property in the `search` configuration:

```js
const results = search(db, {
  term: "Movie about cars and racing",
  properties: ["description"],
  facets: {
    "categories.primary": {
      limit: 3,
      order: "DESC",
    },
    "categories.secondary": {
      limit: 2,
      order: "DESC",
    },
    rating: {
      ranges: [
        { from: 0, to: 3 },
        { from: 3, to: 7 },
        { from: 7, to: 10 },
      ],
    },
    isFavorite: {
      true: true,
      false: true,
    },
  },
});
```

This will generate the following result:

```js
{
  elapsed: ...,
  count: ...,
  hits: { ... },
  facets: {
    'categories.first': {
      count: 14,
      values: {
        'Action': 4,
        'Adventure': 3,
        'Comedy': 2,
      }
    },
    'categories.second': {
      count: 14,
      values: {
        'Cars': 4,
        'Racing': 3,
      }
    },
    rating: {
      count: 3,
      values: {
        '0-3': 5,
        '3-7': 15,
        '7-10': 80,
      }
    },
    isFavorite: {
      count: 2,
      values: {
        'true': 5,
        'false': 95,
      }
    },
  }
}
```

As you may have noticed, the `facets` property is an `object` that contains different
configurations depending on the property type specified in the schema.

## String facets [#string-facets]

If a property is specified as `string` in the schema, the facet will accept the following
configuration:

| Property | Type     | Default | Description                                         |
| -------- | -------- | ------- | --------------------------------------------------- |
| `order`  | `string` | `DESC`  | Order of the values. Can be either `ASC` or `DESC`. |
| `limit`  | `number` | `10`    | Maximum number of values to return.                 |
| `offset` | `number` | `0`     | Number of values to skip.                           |

In the search result, `string` facets will be returned as an `object` with the following properties:

```js
{
  count: 14,            // Total number of values, now limited to 3 (size)
  values: {
    'Action': 4,        // Number of documents that have this value
    'Adventure': 3,     // Number of documents that have this value
    'Comedy': 2,        // Number of documents that have this value
  }
}
```

## Number facets [#number-facets]

If a property is specified as `number` in the schema, the facet will accept the following
configuration:

| Property | Type    | Default | Description                  |
| -------- | ------- | ------- | ---------------------------- |
| `ranges` | `array` | `[]`    | Array of ranges to consider. |

Each range is an `object` with the following properties:

| Property | Type     | Description                 |
| -------- | -------- | --------------------------- |
| `from`   | `number` | Minimum value of the range. |
| `to`     | `number` | Maximum value of the range. |

In the search result, `number` facets will be returned as an `object` with the following properties:

```js
{
  count: 3,      // Total number of ranges
  values: {
    '0-3': 5,    // Number of documents that have a value between 0 and 3 (inclusive)
    '3-7': 15,   // Number of documents that have a value between 3 and 7 (inclusive)
    '7-10': 80,  // Number of documents that have a value between 7 and 10 (inclusive)
  }
}
```

Please note that the `from` and `to` values are **inclusive**. Note also that the order of the ranges
is guaranteed as specified in the configuration.

## Boolean facets [#boolean-facets]

If a property is specified as `boolean` in the schema, the facet will accept the following
configuration:

| Property | Type      | Default | Description                         |
| -------- | --------- | ------- | ----------------------------------- |
| `true`   | `boolean` | `true`  | Whether to consider `true` values.  |
| `false`  | `boolean` | `true`  | Whether to consider `false` values. |

In the search result, `boolean` facets will be returned as an `object` with the following properties:

```js
{
  count: 2,       // Total number of values
  values: {
    'true': 5,    // Number of documents that have a `true` value
    'false': 95,  // Number of documents that have a `false` value
  }
}
```

## Enum facets [#enum-facets]

If a property is specified as `enum` in the schema, no configuration is required.
In the search result, `enum` facets will be returned as an `object` with the following properties:

```js
{
  count: 9,            // Total number of values
  values: {
    'Action': 4,        // Number of documents that have this value
    'Adventure': 3,     // Number of documents that have this value
    'Comedy': 2,        // Number of documents that have this value
  }
}
```

## How facets works on array fields [#how-facets-works-on-array-fields]

ZBSearch treats each array element as a single element of the facet:

```javascript copy
const db = create({
  schema: {
    name: "string[]",
  },
});
insert(db, {
  name: ["Albus", "Percival Wulfric Brian"],
});

const results = search(db, {
  facets: {
    name: {},
  },
});
```

`result.facets` is the following object:

```json
{
  "count": 2,
  "values": {
    "Albus": 1,
    "Percival Wulfric Brian": 1
  }
}
```
# Filters (/docs/zbsearch/search/filters)



You can use the `filters` interface to filter the search results.

Filters are available for numeric, boolean, string, enum, and geopoint properties.
Depending on the type of the property, you can use different operators.

## String operators [#string-operators]

On string properties it performs an exact matching on tokens so it is advised to disable stemming for the properties
you want to use filters on (when using the default tokenizer you can provide the `stemmerSkipProperties` configuration property).

If we consider the following schema:

```javascript copy
const db = create({
  schema: {
    title: "string",
    tag: "string",
  },
  components: {
    tokenizer: {
      stemming: true,
      stemmerSkipProperties: ["tag"],
    },
  },
});

const results = search(db, {
  term: "prestige",
  where: {
    tag: "new",
  },
});
```

The `results` will contain all documents that contain the word `prestige` in the `title` property and have `tags` property equal to `new`.

You can also specify a list of string, in this case it will return all documents that contain at least one of the values provided:

```javascript copy
const results = search(db, {
  term: "prestige",
  where: {
    tag: ["favorite", "new"],
  },
});
```

## Number operators [#number-operators]

The number properties support the following operators:

| Operator  | Description                    | Example                           |
| --------- | ------------------------------ | --------------------------------- |
| `gt`      | Greater than                   | `year: { gt: 2000 }`              |
| `gte`     | Greater than or equal to       | `year: { gte: 2000 }`             |
| `lt`      | Less than                      | `year: { lt: 2000 }`              |
| `lte`     | Less than or equal to          | `year: { lte: 2000 }`             |
| `eq`      | Equal to                       | `year: { eq: 2000 }`              |
| `between` | Between two values (inclusive) | `year: { between: [2000, 2008] }` |

```javascript copy
const db = create({
  schema: {
    id: "string",
    title: "string",
    year: "number",
    meta: {
      rating: "number",
      length: "number",
      favorite: "boolean",
      tags: "string",
    },
  },
  components: {
    tokenizer: {
      stemming: true,
      stemmerSkipProperties: ["meta.tags"],
    },
  },
});

const results = search(db, {
  term: "prestige",
  where: {
    year: {
      gte: 2000,
    },
    "meta.rating": {
      between: [5, 10],
    },
    "meta.length": {
      lte: 60,
    },
  },
});
```

## Boolean operators [#boolean-operators]

For boolean properties, you can simply set the property to `true` or `false`:

```javascript copy
const results = search(db, {
  term: "prestige",
  where: {
    "meta.favorite": true,
  },
});
```

## String\[] | Number\[] | Boolean\[] operators [#string--number--boolean-operators]

The available operators depend on the type (string, number of boolean) as described in the previous sections.
A document matches if at least one of the array elements matches the filter condition.

```javascript copy
const db = create({
  schema: {
    title: "string",
    tags: "string[]",
    editions: "number[]",
    limited: "boolean[]",
  }
});

insertMultiple(db, [
  {title: "a", tags: ["foo", "bar"], editions: [1990, 2024], limited: [false, false]},
  {title: "b", tags: ["foo"], editions: [1942, 2024], limited: [false, true]},
  {title: "c", tags: ["bar"], editions: [2020], limited: [false]},
])

// Books with tag foo
search(db, {where: {tags: "foo"}}); // returns  a, b

// Books tagged either as foo or bar
search(db, {where: {tags: ["foo", "bar"]}}); // returns a, b, c

// Books with a 2024 edition
search(db, {where: {editions: {eq: 2024}}}); // returns a, b

// Books with a limited edition
search(db, {where: {limited: true}}); // returns b
```

## Enum operators [#enum-operators]

The enum properties support the following operators:

| Operator | Description                      | Example                              |
| -------- | -------------------------------- | ------------------------------------ |
| `eq`     | Equal to                         | `genre: { eq: 'drama' }`             |
| `in`     | Contained in the given array     | `genre: { in: ['drama', 'horror'] }` |
| `nin`    | Not contained in the given array | `genre: { nin: ['comedy'] }`         |

## Enum\[] operators [#enum-operators-1]

The enum properties support the following operators:

| Operator      | Description                      | Example                                                  |
| ------------- | -------------------------------- | -------------------------------------------------------- |
| `containsAll` | Contains all the given values    | `genre: { containsAll: ['comedy', 'action'] }`           |
| `containsAny` | Contains any of the given values | `genre: { containsAny: ['comedy', 'action', 'horror'] }` |

## Geosearch [#geosearch]

Starting from ZBSearch `v2.0.0`, you can perform geosearch queries.

Even though the APIs are very simple, we decided to dedicate a separate section for them. This lets us explain the concepts behind the geosearch and how it works with more details.

[Read more about geosearch](/docs/zbsearch/search/geosearch)
# Sorting (/docs/zbsearch/search/sorting)



To sort, ZBSearch uses the properties defined in the `schema` to know on which properties you want to sort.

```javascript copy
const db = create({
  schema: {
    title: "string",
    year: "number",
    inPromotion: "boolean",
    meta: {
      tag: "string",
      rating: "number",
      favorite: "boolean",
    },
  },
});
const results = search(db, {
  term: "prestige",
  sortBy: {
    property: "title", // or 'year', 'inPromotion'
  },
});
```

ZBSearch supports sorting on 'string', 'number' and 'boolean'. The arrays are not supported.

You can also specify nested properties using the '.' notation: `'meta.tag'`, `'meta.rating'` and `'meta.favorite'`. For example:

```javascript
const results = search(db, {
  term: "prestige",
  sortBy: {
    property: "meta.rating",
  },
});
```

## Reverse order [#reverse-order]

ZBSearch supports the reverse order specifying the key `order`:

```javascript
const db = create({
  schema: {
    title: "string",
    year: "number",
    inPromotion: "boolean",
    meta: {
      tag: "string",
      rating: "number",
      favorite: "boolean",
    },
  },
});
const results = search(db, {
  term: "prestige",
  sortBy: {
    property: "title", // or 'year', 'inPromotion'
    order: "DESC", // default is "ASC"
  },
});
```

## Memory optimization [#memory-optimization]

By default, ZBSearch allows the sort on all properties defined in the schema.
This creates an in-memory sort index for each properties.
If you want to optimize the memory usage, ZBSearch supports the `unsortableProperties` list.

```javascript
const db = create({
  schema: {
    title: "string",
    year: "number",
    inPromotion: "boolean",
    meta: {
      tag: "string",
      rating: "number",
      favorite: "boolean",
    },
  },
  sortBy: {
    unsortableProperties: ["year", "meta.tag"],
  },
});
```

## Custom sort [#custom-sort]

ZBSearch allows you to specify the sort algorithm in the following way:

```javascript
const db = create({
  schema: {
    title: "string",
    year: "number",
    inPromotion: "boolean",
    meta: {
      tag: "string",
      rating: "number",
      favorite: "boolean",
    },
  },
  sortBy: (a, b) => {
    // Implement the custom sort algorithm
    return a[2].year - b[2].year;
  },
});
```

The function accepts 2 parameter with the following format `[string, number, Document]` that stands for:

* id of the document
* score of the document
* the document

## Disable sort [#disable-sort]

You can disable the sort functionality using the following snippet:

```javascript
const db = create({
  schema: {
    // The schema
  },
  sort: {
    enabled: false,
  },
});
```
# Grouping (/docs/zbsearch/search/grouping)



ZBSearch supports `groupBy` operations.
That allows you to group results in groups calculating an aggregation on the item that belongs to the same bucket.

```javascript
const results = search(db, {
  term: "t-shirt",
  groupBy: {
    properties: ["design"], // required: property on which we want to group on
    maxResult: 1, // optional: for every group, how many results we want
    reduce: {
      // optional: customize the aggregation logic
      reducer: Function,
      getInitialValue: Function,
    },
  },
});
```

By default, ZBSearch doesn't limit the number of items inside a group.

By default, ZBSearch groups all the matched documents into an array.

## Simple usage [#simple-usage]

If we consider the following schema:

```javascript copy+
const db = create({
  schema: {
    id: "string",
    type: "string",
    design: "string",
    color: "string",
    rank: "number",
    isPromoted: "boolean",
  },
});
const ids = insertMultiple(db, [
  {
    id: "0",
    type: "t-shirt",
    design: "A",
    color: "blue",
    rank: 3,
    isPromoted: true,
  },
  {
    id: "1",
    type: "t-shirt",
    design: "A",
    color: "green",
    rank: 5,
    isPromoted: false,
  },
  {
    id: "2",
    type: "t-shirt",
    design: "A",
    color: "red",
    rank: 4,
    isPromoted: false,
  },
  {
    id: "3",
    type: "t-shirt",
    design: "B",
    color: "blue",
    rank: 4,
    isPromoted: false,
  },
  {
    id: "4",
    type: "t-shirt",
    design: "B",
    color: "green",
    rank: 4,
    isPromoted: true,
  },
  {
    id: "5",
    type: "t-shirt",
    design: "B",
    color: "white",
    rank: 5,
    isPromoted: false,
  },
  {
    id: "6",
    type: "t-shirt",
    design: "B",
    color: "gray",
    rank: 5,
    isPromoted: true,
  },
  {
    id: "7",
    type: "sweatshirt",
    design: "A",
    color: "yellow",
    rank: 3,
    isPromoted: true,
  },
  {
    id: "8",
    type: "sweatshirt",
    design: "A",
    color: "green",
    rank: 4,
    isPromoted: false,
  },
]);
```

We will be able to have the documents per `design` ordered by `rank`:

```javascript copy
const results = search(db, {
  term: "t-shirt",
  groupBy: {
    properties: ["design"], // property on which we want to group on
  },
  sortBy: {
    property: "rank", // inside a group, the result is ordered following this property
    order: "DESC", // with this order
  },
});
```

If you want only the top-ranked document per `design`, you can specify the `maxResult`:

```javascript
const results = search(db, {
  term: "t-shirt",
  groupBy: {
    properties: ["design"],
    maxResult: 1, // for every group, how many results we want
  },
  sortBy: {
    property: "rank",
    order: "DESC",
  },
});
```

The above query returns something like this:

```js
{
  groups: [
    {
      values: ['A'], // list of the values the group is referring to
      result: [
        {
          id: '1',
          score: 0,
          document: { ... } // the doc with id '1'
        }
      ]
    },
    {
      values: ['B'], // list of the values the group is referring to
      result: [
        {
          id: '5',
          score: 0,
          document: { ... } // the doc with id '5'
        }
      ]
    }
  ],
  // The other common properties like `hits` and `elapsed`
}
```

You can group on multiple properties as follows:

```javascript
const results = search(db, {
  term: "red t-shirt",
  groupBy: {
    properties: ["design", "rank", "isPromoted"], // group on the combination of the values
  },
  sortBy: {
    property: "id",
    order: "ASC",
  },
});
```

## Custom reducer [#custom-reducer]

ZBSearch supports custom aggregator as follows:

```typescript
// The document interface
interface Doc extends Document {
  type: string;
  design: string;
  rank: number;
  color: string;
  isPromoted: boolean;
}
// The aggregation interface
interface AggregationValue {
  type: string;
  design: string;
  colors: string[];
  ranks: number[];
  isPromoted: boolean;
}

const results = search(db, {
  term: "red t-shirt",
  groupBy: {
    properties: ["type", "design"], // group on both properties
    reduce: {
      // the accumulator function
      reducer: (
        values: ScalarSearchableValue[],
        acc: AggregationValue,
        item: Result
      ) => {
        const doc = item.document as Doc;
        acc.type ||= doc.type;
        acc.design ||= doc.design;
        acc.isPromoted ||= doc.isPromoted;
        acc.colors.push(doc.color);
        acc.ranks.push(doc.rank);
        return acc;
      },
      // The initial value: this is called for every group
      getInitialValue: (): AggregationValue => ({
        type: "",
        design: "",
        colors: [],
        ranks: [],
        isPromoted: false,
      }),
    },
  },
  sortBy: {
    property: "rank",
    order: "DESC",
  },
});
```

Where the accumulator function receives the following parameters:

1. the value of the current groups
2. the accumulator returned by the previous invocation
3. the item to accumulate

The reducer is called for every item for every group.
# Threshold (/docs/zbsearch/search/threshold)



The threshold property is used to set the minimum/maximum number of results to return.

## The problem [#the-problem]

Let's consider the following example:

```javascript
import { create, insert, search } from "zbsearch";

const db = create({
  schema: {
    title: "string",
  },
});

insert(db, { title: "Blue t-shirt, slim fit" });
insert(db, { title: "Blue t-shirt, regular fit" });
insert(db, { title: "Red t-shirt, slim fit" });
insert(db, { title: "Red t-shirt, oversize fit" });
```

As you can see, we're inserting 4 documents with a lot of common keywords.

What happens if I search for `"t-shirt"`?

```javascript
const results = search(db, {
  term: "t-shirt",
});

// results.count = 4
```

In that case, every single document will be returned, as they all contain the `"t-shirt"` keyword.

Now, what happens if I search for `"regular fit"`?

```javascript
const results = search(db, {
  term: "regular fit",
});

// results.count = 4
```

What! Why do I get 4 results? I only have 1 document that contains the `"regular fit"` keyword!

Well, ZBSearch will position the document containing the `"regular fit"` keyword at the top of the results, but it will also return the other 3 documents, as they also contain the `"fit"` keyword.

With very long search queries, this can lead to a lot of results, which depending on your index size, it might not be what you want.

Imagine you have a database with 1 million documents, and you want to search for `"red t-shirt with long sleeves and a motorbike printed on the front"`. That's a pretty broad search, right? Maybe it's the case to limit the results a bit.

## Using the `threshold` property [#using-the-threshold-property]

The `threshold` property solves this problem by limiting (or maximizing) the number of results to return when performing a search operation.
It must be a number between `0` and `1`, and it represents the percentage of results to return.

### Setting the threshold to `1` (default) [#setting-the-threshold-to-1-default]

By default, ZBSearch sets the threshold to `1`. This means that all the results will be returned.

```javascript
const results = search(db, {
  term: "slim fit",
});
```

This will return **all** the documents containing **either** the `"slim"` keyword **or** the `"fit"` keyword. In our case, considering the example above, **all** the documents will be returned.

### Setting the threshold to `0` [#setting-the-threshold-to-0]

Considering the example above, it will work the following way:

```javascript
const results = search(db, {
  term: "slim fit",
  threshold: 0,
});
```

In this case, the `threshold` property is set to `0`, which means that only the document containing the `"slim fit"` keywords will be returned.
This applies to all the document properties; if a keyword is found in a property, and another keyword is found in a different property, the document will be returned.

You can boost the results depending on where a property is found using the [field boosting](/docs/zbsearch/search/fields-boosting) API.

### Setting the threshold to a value between `0` and `1` [#setting-the-threshold-to-a-value-between-0-and-1]

```javascript
const results = search(db, {
  term: "slim fit",
  threshold: 0.6,
});
```

In this case, the `threshold` property is set to `0.6`, which means that only the document containing the `"slim fit"` keywords will be returned, plus 60% of the other documents containing either the `"slim"` keyword or the `"fit"` keyword.
# Preflight Search (/docs/zbsearch/search/preflight)



**Preflight search** is an ZBSearch feature that allows you to run a preliminary search query that will return just the number of results that match your query. This is useful for determining if a search query will return a large number of results, which can be useful for determining if you should run a full search query and facets (if needed).

## Usage [#usage]

To run a preflight search, you can use the `preflight: boolean` property when using the `search` function.

Let's see it in action:

```javascript
import { create, insert, search } from "zbsearch";

const db = create({
  schema: {
    title: "string",
  },
});

insert(db, { title: "Red headphones" });
insert(db, { title: "Green headphones" });
insert(db, { title: "Blue headphones" });
insert(db, { title: "Yellow headphones" });

const results = search(db, {
  term: "headphones",
  preflight: true,
});

console.log(results);

// {
//   elapsed: {
//     raw: 181208,
//     formatted: '181μs'
//   }
//   hits: []
//   count: 4
// }
```

The `results` object will return a standard ZBSearch response, but the `hits` property will be an empty array.

ZBSearch is extremely fast at searching, and loses a large portion of the `elapsed` time retrieving documents and assigning them to the final `results.hits` array.

By using a `preflight` request, you will be able to retrieve facets and a total number of results in a very fast manner, and then run a full search query if needed.

## How is that useful? [#how-is-that-useful]

Preflight requests are particularly useful in certain situations, like when spawned right before a query with a certain [threshold](/docs/zbsearch/search/threshold).

For example, let's say you have a large database of 50,000 products. If a user searches for a very rare product, you may end up with just a few results if the threshold is set to `0` (exact match).

By running a preflight search, you will be able to programmatically set a different threshold based on the number of results returned by the preflight search.

### Scenarios [#scenarios]

* **The preflight search returns 3 results**. You can set the threshold to `0.5`, returning the 3 results + 50% of the fuzzy-matched results.
* **The preflight search returns 10 results**. You can set the threshold to `0.2`, returning the 10 results + 20% of the fuzzy-matched results.
* **The preflight search returns 100 results**. You can set the threshold to `0`, returning only the 100 exact-matched results.

Read the [threshold](/docs/zbsearch/search/threshold) documentation for more information on how the `threshold` parameter affects search results.
# BM25 Algorithm (/docs/zbsearch/search/bm25)



ZBSearch uses the [BM25](https://en.wikipedia.org/wiki/Okapi_BM25) algorithm to calculate the relevance of a document when searching.

The BM25 algorithm is a ranking function used in search engines to score and rank documents that are relevant to a given query. It is an improvement over the older TF-IDF algorithm, which also assigns weights to terms based on their frequency, but does not take into account the length of the document or the average length of documents in the corpus. BM25 uses a similar approach, but also incorporates the inverse document frequency of each term, as well as a set of adjustable parameters that can be tuned to improve performance. The result is a more accurate ranking of documents that are relevant to a given query.

BM25 has become a popular algorithm for search engine ranking due to its flexibility and effectiveness. It can be adapted to different types of search tasks, from ad-hoc search to recommendation systems, and can be tuned to perform well on specific domains or languages. Additionally, it is computationally efficient and easy to implement, which makes it a practical choice for large-scale search systems.

You can edit the BM25 parameters by using the `relevance` property in the `search`
configuration object.

```javascript copy
const searchResult = search(movieDB, {
  term: "Chris",
  properties: ["director"],
  relevance: {
    // Term frequency saturation parameter.
    // Default value: 1.2
    // Recommended value: between 1.2 and 2
    k: 1.2,

    // Length normalization parameter.
    // Default value: 0.75
    // Recommended value: > 0.75
    b: 0.75,

    // Frequency normalization lower bound.
    // Default value: 0.5
    // Recommended value: between 0.5 and 1
    d: 0.5,
  },
});
```

You can learn more about the BM25 algorithm in the [Okapi BM25 Wikipedia](https://en.wikipedia.org/wiki/Okapi_BM25) page.
# Officially Supported Languages (/docs/zbsearch/supported-languages)



Right now, ZBSearch supports 33 languages out of the box in 8 different alphabets. \
For every language, ZBSearch provides a default tokenizer, stop-words, and stemmer.

<Callout title="🇨🇳🇯🇵 A note on Chinese and Japanese">
  At the time of writing, Chinese (Mandarin) and Japanese are the only exception, since ZBSearch provides everything by default but the stemmer.

  Since Chinese and Japanese logograms follow different rules than other alphabets, you will need to import a dedicated tokenizer for it.

  Read more here about Chinese [here](/docs/zbsearch/supported-languages/using-chinese-with-zbsearch) and about Japanese [here](/docs/zbsearch/supported-languages/using-japanese-with-zbsearch).
</Callout>

## Multilingual mode (zero-config) [#multilingual-mode-zero-config]

If you don't know the language of your documents ahead of time - or a single index mixes several languages - use `multilingual` instead of a specific language:

```js
import { create } from 'zbsearch'

const db = create({
  schema: { title: 'string', content: 'string' },
  language: 'multilingual'
})
```

In this mode ZBSearch tokenizes with [`Intl.Segmenter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) (Unicode word segmentation, with a Unicode regex fallback on runtimes that lack it), so Latin, Cyrillic, Greek, Arabic, Hebrew, Indic, and CJK text all index correctly with no per-language setup. Tokens are lowercased, and diacritics are folded so that `café` matches `cafe`, `ёлка` matches `елка`, and `آلاف` matches `الاف`.

Trade-offs compared to a per-language configuration:

* **No stemming and no stop-words by default.** Queries for inflected forms (`running` vs. `run`) won't match unless you pass a custom `stemmer` function. Per-language installs with `@zbsearch/stemmers` remain the quality ceiling for single-language content: in the quality benchmark that ships with the repo (`benchmarks/`, `npm run benchmark:multilingual-quality`), the multilingual mode reaches \~0.70 recall\@10 vs \~0.98 for tuned per-language installs, with most of the gap on inflection queries — while non-Latin scripts go from 0 (English default) to fully searchable.
* **CJK segmentation is script-based, not dictionary-based.** It works well with prefix search, but for production Japanese or Chinese search prefer the [dedicated tokenizers](/docs/zbsearch/supported-languages/using-japanese-with-zbsearch).
* Sorting falls back to the runtime's default collation, since there is no single locale.

For multilingual *sites* (one locale per document), the recommended pattern is to keep a single multilingual index and store the locale as an `enum`, then filter at query time:

```js
const db = create({
  schema: { title: 'string', content: 'string', locale: 'enum' },
  language: 'multilingual'
})

await search(db, { term: 'getting started', where: { locale: { eq: 'it' } } })
```

### Latin Alphabet [#latin-alphabet]

| Language       | Tokenizer | Stop-words | Stemmer |
| -------------- | --------- | ---------- | ------- |
| Czech          | ✅         | ✅          | ✅       |
| Danish         | ✅         | ✅          | ✅       |
| Dutch          | ✅         | ✅          | ✅       |
| English        | ✅         | ✅          | ✅       |
| Finnish        | ✅         | ✅          | ✅       |
| French         | ✅         | ✅          | ✅       |
| German         | ✅         | ✅          | ✅       |
| Hungarian      | ✅         | ✅          | ✅       |
| Indonesian     | ✅         | ✅          | ✅       |
| Irish          | ✅         | ✅          | ✅       |
| Italian        | ✅         | ✅          | ✅       |
| Lithuanian     | ✅         | ✅          | ✅       |
| Norwegian      | ✅         | ✅          | ✅       |
| Portuguese     | ✅         | ✅          | ✅       |
| Romanian (\*)  | ✅         | ✅          | ✅       |
| Serbian (\*\*) | ✅         | ✅          | ✅       |
| Slovenian      | ✅         | ✅          | ✅       |
| Spanish        | ✅         | ✅          | ✅       |
| Swedish        | ✅         | ✅          | ✅       |
| Turkish        | ✅         | ✅          | ✅       |
| Vietnamese     | ✅         | ✅          | ✅       |

(\*) = also uses a few additional diacritic marks \
(\*\*) = uses both Cyrillic and Latin scripts

### Cyrillic Alphabet [#cyrillic-alphabet]

| Language     | Tokenizer | Stop-words | Stemmer |
| ------------ | --------- | ---------- | ------- |
| Bulgarian    | ✅         | ✅          | ✅       |
| Russian      | ✅         | ✅          | ✅       |
| Serbian (\*) | ✅         | ✅          | ✅       |
| Ukrainian    | ✅         | ✅          | ✅       |

(\*) = uses both Cyrillic and Latin scripts

### Greek Alphabet [#greek-alphabet]

| Language | Tokenizer | Stop-words | Stemmer |
| -------- | --------- | ---------- | ------- |
| Greek    | ✅         | ✅          | ✅       |

### Devanagari Script [#devanagari-script]

| Language | Tokenizer | Stop-words | Stemmer |
| -------- | --------- | ---------- | ------- |
| Hindi    | ✅         | ✅          | ✅       |
| Nepali   | ✅         | ✅          | ✅       |
| Sanskrit | ✅         | ✅          | ✅       |

### Arabic Script [#arabic-script]

| Language | Tokenizer | Stop-words | Stemmer |
| -------- | --------- | ---------- | ------- |
| Arabic   | ✅         | ✅          | ✅       |

### Armenian Alphabet [#armenian-alphabet]

| Language | Tokenizer | Stop-words | Stemmer |
| -------- | --------- | ---------- | ------- |
| Armenian | ✅         | ✅          | ✅       |

### Tamil Script [#tamil-script]

| Language | Tokenizer | Stop-words | Stemmer |
| -------- | --------- | ---------- | ------- |
| Tamil    | ✅         | ✅          | ✅       |

### Chinese Characters (Logographic Script) [#chinese-characters-logographic-script]

| Language           | Tokenizer | Stop-words | Stemmer |
| ------------------ | --------- | ---------- | ------- |
| Chinese (Mandarin) | ✅         | ✅          | ❌       |
| Japanese           | ✅         | ✅          | ❌       |
