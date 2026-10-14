// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript", "tree-view", "symbol", "symbol-tree-sitter"],
  viewport: { width: 1200, height: 760 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("Signal Lab/src/signal.js");
    await lumine.project.setPaths([fixture("Signal Lab")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Follow the file path and enclosing symbols while editing.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "tree-view:show");
          state.editor.setCursorBufferPosition([13, 18]);
        }
      },
      ready() {
        return Boolean(document.querySelector(".breadcrumbs"));
      },
    },
  ],
  async cleanup() {},
};
