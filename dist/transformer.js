"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var nodePath = require("path");
var tsconfig_paths_1 = require("tsconfig-paths");
var utils = require("tsutils");
var ts = require("typescript");
require.extensions[".ts"] = require.extensions[".js"];
require.extensions[".tsx"] = require.extensions[".js"];
var absoluteBaseUrl;
var compilerOptions;
var matchPathFunc;
function getModuleSpecifierValue(specifier) {
    return specifier.getText().substr(specifier.getLeadingTriviaWidth(), specifier.getWidth() - specifier.getLeadingTriviaWidth() * 2);
}
function isPathRelative(path) {
    return path.startsWith("./") || path.startsWith("../");
}
function shouldAddCurrentWorkingDirectoryPath(baseUrl) {
    if (!baseUrl) {
        return true;
    }
    var worksOnUnix = baseUrl[0] === "/";
    var worksOnWindows = new RegExp("^[A-Z]:/").test(baseUrl);
    return !(worksOnUnix || worksOnWindows);
}
;
function runTransformer(program) {
    var checker = program.getTypeChecker();
    function processNode(node, file) {
        if (utils.isCallExpression(node)) {
            var signature = checker.getResolvedSignature(node);
            var decl = signature.declaration;
            if (!decl)
                return;
            if (decl.kind == ts.SyntaxKind.FunctionDeclaration) {
                var funcName = decl.name.escapedText;
                if (funcName === "compiletime") {
                    var argument = node.arguments[0];
                    var codeBlock = argument.getFullText();
                    var transpiledJs = ts.transpile(codeBlock).trimRight();
                    if (transpiledJs[transpiledJs.length - 1] === ";") {
                        transpiledJs = transpiledJs.substr(0, transpiledJs.length - 1);
                    }
                    var result = eval("(" + transpiledJs + ")()");
                    if (utils.isVariableDeclaration(node.parent) || utils.isExportAssignment(node.parent)) {
                        return ts.createStringLiteral(result);
                    }
                    return ts.createStringLiteral(""); // TODO: delete node (return undefined not working)
                }
            }
        }
        else if (utils.isImportDeclaration(node)) {
            if (!node.moduleSpecifier || !node.moduleSpecifier.getSourceFile()) {
                return node;
            }
            var sourceFilePath = nodePath.dirname(file.fileName);
            var specifierValue = getModuleSpecifierValue(node.moduleSpecifier);
            var matchedPath = matchPathFunc(specifierValue);
            if (!matchedPath) {
                return node;
            }
            var newNode = ts.getMutableClone(node);
            var replacePath = nodePath.relative(sourceFilePath, matchedPath).replace(/\\/g, "/");
            newNode.moduleSpecifier = ts.createLiteral(isPathRelative(replacePath) ? replacePath : "./" + replacePath);
            return newNode;
        }
        return;
    }
    function processSourceFile(context, file) {
        function visitor(node) {
            var newNode = processNode(node, file);
            if (newNode != undefined) {
                return newNode;
            }
            return ts.visitEachChild(node, visitor, context);
        }
        return ts.visitEachChild(file, visitor, context);
    }
    function processAndUpdateSourceFile(context, file) {
        var updatedNode = processSourceFile(context, file);
        return ts.updateSourceFileNode(file, updatedNode.statements, updatedNode.isDeclarationFile, updatedNode.referencedFiles, updatedNode.typeReferenceDirectives, updatedNode.hasNoDefaultLib);
    }
    return function (context) { return function (node) {
        compilerOptions = context.getCompilerOptions();
        absoluteBaseUrl = shouldAddCurrentWorkingDirectoryPath(compilerOptions.baseUrl)
            ? nodePath.join(process.cwd(), compilerOptions.baseUrl || ".")
            : compilerOptions.baseUrl || ".";
        matchPathFunc = tsconfig_paths_1.createMatchPath(absoluteBaseUrl, compilerOptions.paths || {});
        try {
            if (ts.isBundle(node)) {
                var newFiles = node.sourceFiles.map(function (file) { return processAndUpdateSourceFile(context, file); });
                return ts.updateBundle(node, newFiles);
            }
            else if (ts.isSourceFile(node)) {
                return processAndUpdateSourceFile(context, node);
            }
        }
        catch (e) {
            console.error(e);
            throw e;
        }
        return node;
    }; };
}
exports.default = runTransformer;
