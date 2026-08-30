const { Point, Range } = require("lumine");
const SymbolPath = require("../lib/symbol-path");

const symbol = (name, start, end, children = []) => ({
  name,
  position: new Point(...start),
  range: new Range(start, end),
  children,
});

describe("breadcrumbs symbol path", () => {
  it("returns the deepest containing hierarchy", () => {
    const tree = [
      symbol(
        "Outer",
        [0, 0],
        [20, 0],
        [symbol("middle", [2, 0], [10, 0], [symbol("inner", [4, 0], [6, 0])])],
      ),
    ];

    expect(SymbolPath.forPosition(tree, new Point(5, 0)).map(({ name }) => name)).toEqual([
      "Outer",
      "middle",
      "inner",
    ]);
    expect(SymbolPath.forPosition(tree, new Point(15, 0)).map(({ name }) => name)).toEqual([
      "Outer",
    ]);
    const delayed = [symbol("Later", [2, 0], [4, 0])];
    expect(SymbolPath.forPosition(delayed, new Point(0, 0))).toEqual([]);
  });

  it("falls back to the nearest preceding point symbol", () => {
    const point = (name, row, children = []) => ({
      name,
      position: new Point(row, 0),
      range: new Range([row, 0], [row, 0]),
      children,
    });
    const tree = [point("first", 1, [point("child", 3)]), point("second", 8)];

    expect(SymbolPath.forPosition(tree, new Point(5, 0)).map(({ name }) => name)).toEqual([
      "first",
      "child",
    ]);
    expect(SymbolPath.forPosition(tree, new Point(9, 0)).map(({ name }) => name)).toEqual([
      "second",
    ]);
    expect(SymbolPath.forPosition(tree, new Point(0, 0))).toEqual([]);
  });

  it("keeps a completed range current until the next symbol begins", () => {
    const tree = [symbol("doc", [2, 0], [2, 3]), symbol("next", [8, 0], [8, 4])];
    expect(SymbolPath.forPosition(tree, new Point(0, 0))).toEqual([]);
    expect(SymbolPath.forPosition(tree, new Point(5, 0)).map(({ name }) => name)).toEqual(["doc"]);
    expect(SymbolPath.forPosition(tree, new Point(9, 0)).map(({ name }) => name)).toEqual(["next"]);
  });

  it("checks a deeply nested containing hierarchy only once per level", () => {
    let rangeChecks = 0;
    let children = [];
    for (let depth = 999; depth >= 0; depth--) {
      children = [
        {
          name: `level-${depth}`,
          position: new Point(depth, 0),
          range: {
            isEmpty: () => false,
            containsPoint: () => {
              rangeChecks++;
              return true;
            },
          },
          children,
        },
      ];
    }

    expect(SymbolPath.forPosition(children, new Point(999, 0)).length).toBe(1000);
    expect(rangeChecks).toBe(1000);
  });

  it("reuses full and last paths for the same active symbol", () => {
    const tree = [symbol("outer", [0, 0], [10, 0], [symbol("inner", [2, 0], [8, 0])])];
    const position = new Point(4, 0);

    expect(SymbolPath.forPosition(tree, position)).toBe(SymbolPath.forPosition(tree, position));
    expect(SymbolPath.lastForPosition(tree, position)).toBe(
      SymbolPath.lastForPosition(tree, position),
    );
  });

  it("skips containment walks for point-only trees", () => {
    let rangeChecks = 0;
    const tree = Array.from({ length: 2048 }, (_, row) => ({
      name: `point-${row}`,
      position: new Point(row, 0),
      range: {
        isEmpty() {
          rangeChecks++;
          return true;
        },
      },
      children: [],
    }));

    SymbolPath.forPosition(tree, new Point(1024, 0));
    const indexingChecks = rangeChecks;
    for (let index = 0; index < 100; index++) {
      SymbolPath.forPosition(tree, new Point(1024 + (index % 2), 0));
    }

    expect(indexingChecks).toBe(tree.length);
    expect(rangeChecks).toBe(indexingChecks);
  });
});
