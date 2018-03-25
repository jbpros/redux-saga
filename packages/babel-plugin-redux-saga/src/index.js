var SourceMapConsumer = require('source-map').SourceMapConsumer
var pathFS = require('path')

var globalSymbolName = '@@redux-saga/LOCATION'

module.exports = function(babel) {
  var { types: t, template } = babel
  var sourceMap = null

  const extendExpressionWithLocation = template(`
    (function reduxSagaSource() {
      return Object.defineProperty(TARGET, SYMBOL_NAME, {
        value: {
          fileName: FILENAME,
          lineNumber: LINE_NUMBER,
          code: SOURCE_CODE
        }
      });
    })();
  `);

  const extendDeclarationWithLocation = template(`
    Object.defineProperty(TARGET, SYMBOL_NAME, {
      value: {
        fileName: FILENAME,
        lineNumber: LINE_NUMBER
      }
    });
  `)

  function getSymbol(useSymbol) {
    return useSymbol === false
      ? t.stringLiteral(globalSymbolName)
      : t.callExpression(
        t.memberExpression(t.identifier('Symbol'), t.identifier('for')),
        [t.stringLiteral(globalSymbolName)]
      )
  }

  function calcLocation(loc, fullName, basePath) {
    var lineNumber = loc.start.line
    var fileName = basePath ? pathFS.relative(basePath, fullName) : fullName

    if (!sourceMap) {
      return {
        lineNumber: lineNumber,
        fileName: fileName,
      }
    }
    var mappedData = sourceMap.originalPositionFor({
      line: loc.start.line,
      column: loc.start.column,
    })

    return {
      lineNumber: mappedData.line,
      fileName: fileName + ' (' + mappedData.source + ')',
    }
  }

  var visitor = {
    Program: function(path, state) {
      // clean up state for every file
      sourceMap = state.file.opts.inputSourceMap ? new SourceMapConsumer(state.file.opts.inputSourceMap) : null
    },
    /**
     * attach location info object to saga
     *
     * @example
     * input
     *  function * effectHandler(){}
     * output
     *  function * effectHandler(){}
     *  effectHandler[_SAGA_LOCATION] = { fileName: ..., lineNumber: ... }
     */
    FunctionDeclaration(path, state) {
      if (path.node.generator !== true) return

      var functionName = path.node.id.name
      var locationData = calcLocation(path.node.loc, state.file.opts.filename, state.opts.basePath)

      const extendedDeclaration = extendDeclarationWithLocation({
        TARGET: t.identifier(functionName),
        SYMBOL_NAME: getSymbol(state.opts.useSymbol),
        FILENAME: t.stringLiteral(locationData.fileName),
        LINE_NUMBER: t.numericLiteral(locationData.lineNumber),
      })

      // https://github.com/babel/babel/issues/4007
      if (path.parentPath.isExportDefaultDeclaration() || path.parentPath.isExportDeclaration()) {
        path.parentPath.insertAfter(extendedDeclaration)
      } else {
        path.insertAfter(extendedDeclaration)
      }
    },
    /**
     * attach location info object to effect descriptor
     *
     * @example
     * input
     *  yield call(smthelse)
     * output
     *  yield (function () {
     *    var res = call(smthelse)
     *    res[_SAGA_LOCATION] = { fileName: ..., lineNumber: ... }
     *    return res
     *  })()
     */
    CallExpression(path, state) {
      var node = path.node
      // NOTE: we are interested only in 2 levels in depth. even that approach is error-prone, probably will be removed
      var isParentYield = path.parentPath.isYieldExpression()
      var isGrandParentYield = path.parentPath.parentPath.isYieldExpression() // NOTE: we don't check whether parent is logical / binary / ... expression
      if (!isParentYield && !isGrandParentYield) return

      if (!node.loc) return
      // if (path.parentPath.node.delegate) return // should we ignore delegated?

      var file = state.file
      var locationData = calcLocation(node.loc, file.opts.filename, state.opts.basePath)
      var sourceCode = path.getSource();

      const extendedExpression = extendExpressionWithLocation({
        TARGET: node,
        SYMBOL_NAME: getSymbol(state.opts.useSymbol),
        FILENAME: t.stringLiteral(locationData.fileName),
        LINE_NUMBER: t.numericLiteral(locationData.lineNumber),
        SOURCE_CODE:  t.stringLiteral(sourceCode),
      });

      path.replaceWith(extendedExpression)
    },
  }

  return {
    visitor,
  }
}
