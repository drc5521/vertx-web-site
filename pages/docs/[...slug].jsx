import Docs from "../../components/layouts/Docs"
import DocsIndex from "../../components/layouts/DocsIndex"
import VersionContext from "../../components/contexts/VersionContext"
import parse5 from "parse5"
import { useContext, useEffect } from "react"

// read docs metadata containing information about documentation categories
// and entries of all Vert.x versions
const metadataModules = require.context("../../docs/metadata", false, /\.jsx$/)
const metadata = metadataModules.keys().map(m => {
  let version = m.substring(2, m.length - 4)
  return { version, metadata: metadataModules(m).default }
}).sort((a, b) => a.version.localeCompare(b.version))

const extractedDocsPath = "docs/extracted"

let asciidoctor
let cache = {}

async function readDirRecursive(dir, fs, path, result = []) {
  let files = await fs.readdir(dir)
  for (let f of files) {
    let absolute = path.join(dir, f)
    if ((await fs.stat(absolute)).isDirectory()) {
      await readDirRecursive(absolute, fs, path, result)
    } else {
      if (f === "index.adoc") {
        result.push(absolute)
      }
    }
  }
  return result
}

export async function getStaticPaths() {
  const fs = require("fs").promises
  const path = require("path")

  let paths = []

  // catch versions
  for (let m of metadata) {
    paths.push({
      params: {
        slug: [m.version, ""]
      }
    })
  }

  // check if documentation source files exist
  try {
    await fs.access(extractedDocsPath)
  } catch (e) {
    console.warn(
      "\n\n**********************************************************\n" +
          "WARNING: AsciiDoc source files of documentation not found.\n" +
          "Please run `npm run update-docs'\n" +
          "**********************************************************\n")
    return {
      paths: [],
      fallback: false
    }
  }

  let files = await readDirRecursive(extractedDocsPath, fs, path)
  for (let f of files) {
    let m = f.match(new RegExp(`${extractedDocsPath}/(.+)index.adoc`))
    if (m) {
      let slug = m[1].split("/")
      if (slug.length > 2) { // don't include index.adoc in parent directory
        paths.push({ params: { slug } })
      }
    }
  }

  return {
    paths,
    fallback: false
  }
}

export async function getStaticProps({ params }) {
  const path = require("path")

  // get version
  let version
  if (metadata.some(m => m.version === params.slug[0])) {
    version = params.slug[0]
  }

  // handle version index
  if (version !== undefined && params.slug.length <= 1) {
    return {
      props: {
        version: params.slug[0]
      }
    }
  }

  // check if generated asciidoc file is in cache
  let slug = params.slug.join("/")
  if (cache[slug]) {
    return cache[slug]
  }

  // load asciidoctor if necessary
  if (typeof asciidoctor === "undefined") {
    asciidoctor = require("asciidoctor")()

    // clean up any previously registered extension
    asciidoctor.Extensions.unregisterAll()

    // register highlight.js extension
    const highlightJsExt = require("asciidoctor-highlight.js")
    highlightJsExt.register(asciidoctor.Extensions)
  }

  // render page
  let doc = asciidoctor.loadFile(path.join(extractedDocsPath, slug, "index.adoc"), {
    safe: "unsafe",
    attributes: {
      "source-highlighter": "highlightjs-ext",
      "showtitle": true,
      "toc": "left"
    }
  })
  let title = doc.getDocumentTitle()
  let contents = doc.convert()

  // parse generated HTML and extract table of contents
  let documentFragment = parse5.parseFragment(contents, { sourceCodeLocationInfo: true })
  let toc = undefined
  for (let child of documentFragment.childNodes) {
    if (child.tagName === "div") {
      for (let attr of child.attrs) {
        if (attr.name === "id" && attr.value === "toc") {
          toc = contents.substring(child.sourceCodeLocation.startOffset,
              child.sourceCodeLocation.endOffset)
          contents = contents.substring(0, child.sourceCodeLocation.startOffset) +
              contents.substring(child.sourceCodeLocation.endOffset)
          break
        }
      }
    }
    if (typeof toc !== "undefined") {
      break
    }
  }

  toc = toc || ""

  cache[slug] = {
    props: {
      title,
      toc,
      contents,
      ...(version && { version })
    }
  }

  return cache[slug]
}

export default ({ title, toc, contents, version }) => {
  const setVersion = useContext(VersionContext.Dispatch)

  useEffect(() => {
    setVersion({ version })
  }, [setVersion, version])

  if (contents === undefined) {
    let m
    if (version !== undefined) {
      m = metadata.find(m => m.version === version)
    } else {
      m = metadata[metadata.length - 1]
    }
    return <DocsIndex metadata={m} version={version} />
  } else {
    return <Docs meta={{ title }} toc={toc} contents={contents} />
  }
}
