// Python runner for the judge.
//
// This file is served as plaintext, unlike the rest of the site: a worker script cannot be
// decrypted before the browser loads it, and a blob-URL worker cannot dynamically import the
// Pyodide runtime from a CDN (the import fails with an opaque fetch error). It is therefore
// written to be generic — it carries no problems, no solutions and no app logic. The grading
// code (harness.py) lives inside the encrypted bundle and is handed over at init.
//
// Protocol (see src/judge/types.ts):
//   in : {type:'init', pyodideIndexURL, harnessSource} | {type:'run', runId, payload}
//   out: {type:'ready'|'test-result'|'run-complete'|'fatal', ...}

let harness = null;

self.onmessage = async (event) => {
  const message = event.data;

  if (message.type === 'init') {
    try {
      const startedAt = performance.now();
      // Pyodide 314 ships ES modules only; classic workers are not supported.
      const mod = await import(`${message.pyodideIndexURL}pyodide.mjs`);
      const pyodide = await mod.loadPyodide({ indexURL: message.pyodideIndexURL });
      pyodide.FS.writeFile('/home/pyodide/harness.py', message.harnessSource);
      harness = pyodide.pyimport('harness');
      self.postMessage({
        type: 'ready',
        pyodideVersion: pyodide.version,
        warmupMs: performance.now() - startedAt,
      });
    } catch (err) {
      self.postMessage({ type: 'fatal', message: `python runtime failed to load: ${err}` });
    }
    return;
  }

  if (message.type === 'run') {
    if (!harness) {
      self.postMessage({ type: 'fatal', runId: message.runId, message: 'runtime not ready' });
      return;
    }
    // One message per test, so a later hang never loses the earlier results.
    const report = (resultJson) =>
      self.postMessage({
        type: 'test-result',
        runId: message.runId,
        result: JSON.parse(resultJson),
      });
    try {
      const summary = JSON.parse(harness.run(JSON.stringify(message.payload), report));
      self.postMessage({ type: 'run-complete', runId: message.runId, summary });
    } catch (err) {
      self.postMessage({ type: 'fatal', runId: message.runId, message: String(err) });
    }
  }
};
