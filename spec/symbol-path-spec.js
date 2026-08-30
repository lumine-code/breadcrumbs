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
    expect(SymbolPath.forPosition(delayed, new Point(0, 0)).map(({ name }) => name)).toEqual([
      "Later",
    ]);
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
    expect(SymbolPath.forPosition(tree, new Point(0, 0)).map(({ name }) => name)).toEqual([
      "first",
    ]);
  });
});
