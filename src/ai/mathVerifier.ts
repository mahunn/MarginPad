/**
 * Client-side deterministic math equivalence verifier powered by @cortex-js/compute-engine.
 * Runs 100% in the browser ($0 cost) to verify whether two LaTeX math expressions are
 * genuinely unequal — filtering out false-positive AI flags when a student simply reorders terms!
 */

let cePromise: Promise<any> | null = null;

async function getComputeEngine() {
  if (!cePromise) {
    cePromise = import('@cortex-js/compute-engine').then(
      (mod) => new mod.ComputeEngine()
    );
  }
  return cePromise;
}

function stripEquationSides(latex: string): string[] {
  return latex
    .replace(/\\implies|\\Rightarrow|->/g, '=')
    .split('=')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Checks whether `wrongLatex` and `correctedLatex` are actually mathematically equivalent.
 * Returns:
 * - `{ verifiedDistinct: true, checkedByCAS: true }` if CAS confirms they differ,
 * - `{ verifiedDistinct: false, checkedByCAS: true }` if CAS proves they are actually equal (suppress false alarm!),
 * - `{ verifiedDistinct: true, checkedByCAS: false }` if symbolic parsing is inconclusive (e.g., physics text or logic proof).
 */
export async function verifyMistakeWithCAS(
  wrongLatex: string,
  correctedLatex: string
): Promise<{ verifiedDistinct: boolean; checkedByCAS: boolean }> {
  if (!wrongLatex.trim() || !correctedLatex.trim()) {
    return { verifiedDistinct: true, checkedByCAS: false };
  }

  try {
    const ce = await getComputeEngine();
    const wrongSides = stripEquationSides(wrongLatex);
    const rightSides = stripEquationSides(correctedLatex);

    // Case 1: Single algebraic expression comparison (e.g. "2x - 3" vs "2x - 6")
    if (wrongSides.length === 1 && rightSides.length === 1) {
      const exprA = ce.parse(wrongSides[0]);
      const exprB = ce.parse(rightSides[0]);
      if (!exprA.isValid || !exprB.isValid) {
        return { verifiedDistinct: true, checkedByCAS: false };
      }
      const isEqual = exprA.isEqual(exprB);
      if (typeof isEqual === 'boolean') {
        return { verifiedDistinct: !isEqual, checkedByCAS: true };
      }
    }

    // Case 2: Two-sided equation comparison (e.g. "2x - 3 = 10" vs "2x - 6 = 10")
    if (wrongSides.length === 2 && rightSides.length === 2) {
      const diffWrong = ce.parse(`(${wrongSides[0]}) - (${wrongSides[1]})`).simplify();
      const diffRight = ce.parse(`(${rightSides[0]}) - (${rightSides[1]})`).simplify();

      if (diffWrong.isValid && diffRight.isValid) {
        const sameZeroSet =
          diffWrong.isEqual(diffRight) === true ||
          diffWrong.isEqual(ce.parse(`-(${diffRight.latex})`)) === true;
        return { verifiedDistinct: !sameZeroSet, checkedByCAS: true };
      }
    }
  } catch {
    // Non-algebraic physics/logic expressions gracefully pass through
  }

  return { verifiedDistinct: true, checkedByCAS: false };
}
