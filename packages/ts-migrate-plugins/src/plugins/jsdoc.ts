import ts, { factory } from 'typescript';
import { Plugin } from 'ts-migrate-server';
import {
  AnyAliasOptions,
  Properties,
  anyAliasProperty,
  createValidate,
} from '../utils/validateOptions';
import UpdateTracker from './utils/update';

type TypeMap = Record<string, TypeOptions>;

type TypeOptions =
  | string
  | {
      tsName?: string;
      acceptsTypeParameters?: boolean;
    };

const defaultTypeMap: TypeMap = {
  String: {
    tsName: 'string',
    acceptsTypeParameters: false,
  },
  Boolean: {
    tsName: 'boolean',
    acceptsTypeParameters: false,
  },
  Number: {
    tsName: 'number',
    acceptsTypeParameters: false,
  },
  Object: {
    tsName: 'object',
    // Object<string, T> and Object<number, T> are handled as a special case.
    acceptsTypeParameters: false,
  },
  date: {
    tsName: 'Date',
    acceptsTypeParameters: false,
  },
  Date: {
    tsName: 'Date',
    acceptsTypeParameters: false,
  },
  Symbol: {
    tsName: 'symbol',
    acceptsTypeParameters: false,
  },
  Function: {
    tsName: 'Function',
    acceptsTypeParameters: false,
  },
  array: 'Array',
  Array: 'Array',
  promise: 'Promise',
};


type Options = {
  annotateReturns?: boolean;
  typeMap?: TypeMap;
} & AnyAliasOptions;

const optionProperties: Properties = {
  ...anyAliasProperty,
  annotateReturns: { type: 'boolean' },
  typeMap: {
    oneOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: { tsName: { type: 'string' }, acceptsTypeParameters: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
  },
};

const jsDocPlugin: Plugin<Options> = {
  name: 'jsdoc',

  run({ sourceFile, options }: { sourceFile: ts.SourceFile; options: Options }) {
    const updates = new UpdateTracker(sourceFile);
    ts.transform(sourceFile, [jsDocTransformerFactory(updates, options)]);
    return updates.apply();
  },

  validate: createValidate(optionProperties),
};

export default jsDocPlugin;

type KeywordTypeSyntaxKind =
  | ts.SyntaxKind.StringKeyword
  | ts.SyntaxKind.NumberKeyword
  | ts.SyntaxKind.BooleanKeyword
  | ts.SyntaxKind.SymbolKeyword
  | ts.SyntaxKind.ObjectKeyword;

const PRIMITIVE_KEYWORDS = new Map<string, KeywordTypeSyntaxKind>([
  ['string', ts.SyntaxKind.StringKeyword],
  ['number', ts.SyntaxKind.NumberKeyword],
  ['boolean', ts.SyntaxKind.BooleanKeyword],
  ['symbol', ts.SyntaxKind.SymbolKeyword],
  ['object', ts.SyntaxKind.ObjectKeyword],
]);

function primitiveKeywordNode(name: string): ts.TypeNode | undefined {
  const kind = PRIMITIVE_KEYWORDS.get(name);
  return kind ? factory.createKeywordTypeNode(kind) : undefined;
}

function getEntityNameText(name: ts.EntityName): string {
  if (ts.isIdentifier(name)) return name.text;
  return `${getEntityNameText(name.left)}.${name.right.text}`;
}


const jsDocTransformerFactory =
  (updates: UpdateTracker, { annotateReturns, anyAlias, typeMap: optionsTypeMap }: Options) =>
  (context: ts.TransformationContext) => {
    const { factory } = context;
    const anyType = anyAlias
      ? factory.createTypeReferenceNode(anyAlias, undefined)
      : factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
    const typeMap: TypeMap = { ...defaultTypeMap, ...optionsTypeMap };
    return (file: ts.SourceFile) => {
      visit(file);
      return file;
    };

    function visit(origNode: ts.Node): void {
      origNode.forEachChild(visit);
      if (ts.isFunctionLike(origNode)) {
        visitFunctionLike(origNode, ts.isClassDeclaration(origNode.parent));
      }
    }

    function visitFunctionLike(node: ts.SignatureDeclaration, insideClass: boolean): void {
      const modifiers =
        ts.isMethodDeclaration(node) && insideClass
          ? modifiersFromJSDoc(node, factory)
          : ts.canHaveModifiers(node)
          ? ts.getModifiers(node)
          : undefined;
      const parameters = visitParameters(node);
      const returnType = annotateReturns ? visitReturnType(node) : node.type;
      if (
        ('modifiers' in node ? modifiers === (node as any).modifiers : modifiers === undefined) &&
        parameters === node.parameters &&
        returnType === node.type
      ) {
        return;
      }

      const newModifiers = modifiers ? factory.createNodeArray(modifiers) : undefined;
      if (newModifiers) {
        // Only access 'modifiers' if the node has that property
        if ('modifiers' in node && node.modifiers) {
          updates.replaceNodes(node.modifiers, newModifiers);
        } else {
          const pos = node.name!.getStart();
          updates.insertNodes(pos, newModifiers);
        }
      }

      const newParameters = factory.createNodeArray(parameters);
      const addParens =
        ts.isArrowFunction(node) && node.getFirstToken()?.kind !== ts.SyntaxKind.OpenParenToken;
      updates.replaceNodes(node.parameters, newParameters, addParens);

      const newType = returnType;
      if (newType) {
        updates.addReturnAnnotation(node, newType);
      }
    }

    function visitParameters(
      fn: ts.SignatureDeclaration
    ): ReadonlyArray<ts.ParameterDeclaration> {
      if (!ts.hasJSDocParameterTags(fn)) return fn.parameters;

      const allParamTags = ts.getJSDocTags(fn)
        .filter((t): t is ts.JSDocParameterTag => t.kind === ts.SyntaxKind.JSDocParameterTag);

      const newParams = fn.parameters.map(param => {
        if (param.type) return param;

        // 🩹 Handle destructured params: { a, b }
        if (ts.isObjectBindingPattern(param.name)) {
          const rootTag = allParamTags.find(
            t => t.name && getEntityNameText(t.name as ts.EntityName).includes('.')
          );
          if (rootTag && rootTag.name) {
            const rootName = getEntityNameText(rootTag.name as ts.EntityName).split('.')[0];
            const type = buildNestedType(rootName, allParamTags);
            return factory.updateParameterDeclaration(
              param,
              param.modifiers,
              param.dotDotDotToken,
              param.name,
              param.questionToken,
              type,
              param.initializer
            );
          }
          // default to generic object if no match
          return factory.updateParameterDeclaration(
            param,
            param.modifiers,
            param.dotDotDotToken,
            param.name,
            param.questionToken,
            factory.createKeywordTypeNode(ts.SyntaxKind.ObjectKeyword),
            param.initializer
          );
        }

        const name = ts.isIdentifier(param.name) ? param.name.text : undefined;
        if (!name) return param;

        const directTag = allParamTags.find(
          t => t.name && ts.isIdentifier(t.name) && t.name.text === name && t.typeExpression
        );

        const nestedTags = allParamTags.filter(t => {
          if (!t.name || !ts.isIdentifier(t.name)) return false;
          return t.name.text.startsWith(`${name}.`);
        });

        let type: ts.TypeNode | undefined;
        let questionToken = param.questionToken;

        if (nestedTags.length) {
          type = buildNestedType(name, allParamTags);
        } else if (directTag?.typeExpression) {
          const typeNode = directTag.typeExpression.type;
          type = visitJSDocType(typeNode);
          questionToken =
            !param.initializer &&
            (directTag.isBracketed || ts.isJSDocOptionalType(typeNode))
              ? factory.createToken(ts.SyntaxKind.QuestionToken)
              : param.questionToken;
        }

        if (!type) return param;

        return factory.updateParameterDeclaration(
          param,
          param.modifiers,
          param.dotDotDotToken,
          param.name,
          questionToken,
          type,
          param.initializer
        );
      });

      return newParams;
    }

    function buildNestedType(prefix: string, allTags: ts.JSDocParameterTag[]): ts.TypeNode {
      // Find all direct children of this prefix using getEntityNameText for QualifiedName support
      const childTags = allTags.filter((tag) => {
        if (!tag.name) return false;
        const tagName = getEntityNameText(tag.name as ts.EntityName);
        if (!tagName.startsWith(`${prefix}.`)) return false;
        const remainder = tagName.substring(prefix.length + 1);
        return !remainder.includes('.'); // Direct children only
      });

      const members = childTags.map((tag) => {
        const tagName = getEntityNameText(tag.name as ts.EntityName);
        const propertyName = tagName.substring(prefix.length + 1);
        const fullPropertyPath = `${prefix}.${propertyName}`;

        // Check if this property has nested children
        const hasNestedChildren = allTags.some((t) => {
          if (!t.name) return false;
          const tName = getEntityNameText(t.name as ts.EntityName);
          return tName.startsWith(`${fullPropertyPath}.`);
        });

        let propertyType: ts.TypeNode;
        if (hasNestedChildren) {
          // Recursively build nested type literal
          propertyType = buildNestedType(fullPropertyPath, allTags);
        } else if (tag.typeExpression) {
          const te = tag.typeExpression.type;
          const inner = ts.isJSDocOptionalType(te) ? (te as ts.JSDocOptionalType).type : te;
          let visited = visitJSDocType(inner);

          if (ts.isTypeReferenceNode(visited) && ts.isIdentifier(visited.typeName)) {
            const text = visited.typeName.text;
            // Try both original case and lowercase for JSDoc primitives
            const normalized = primitiveKeywordNode(text) || primitiveKeywordNode(text.toLowerCase());
            if (normalized) {
              visited = normalized;
            }
          }
          propertyType = visited;
        } else {
          propertyType = anyType;
        }

        const isOptional = tag.isBracketed || (tag.typeExpression && ts.isJSDocOptionalType(tag.typeExpression.type));

        return factory.createPropertySignature(
          undefined,
          propertyName,
          isOptional ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
          propertyType
        );
      });

      return factory.createTypeLiteralNode(members);
    }

    function visitReturnType(
      functionDeclaration: ts.SignatureDeclaration,
    ): ts.TypeNode | undefined {
      if (functionDeclaration.type) {
        // Don't overwrite existing annotations.
        return functionDeclaration.type;
      }
      const returnTypeNode = ts.getJSDocReturnType(functionDeclaration);
      if (!returnTypeNode) {
        return functionDeclaration.type;
      }
      return visitJSDocType(returnTypeNode);
    }

    // All visitJSDoc functions are adapted from:
    // https://github.com/microsoft/TypeScript/blob/v5.9.3/src/services/codefixes/annotateWithTypeFromJSDoc.ts

    function visitJSDocType(node: ts.Node): ts.TypeNode {
      switch (node.kind) {
        case ts.SyntaxKind.JSDocAllType:
        case ts.SyntaxKind.JSDocUnknownType:
          return anyType;
        case ts.SyntaxKind.JSDocOptionalType:
          return ts.visitNode((node as ts.JSDocOptionalType).type, visitJSDocType) as ts.TypeNode;
        case ts.SyntaxKind.JSDocNonNullableType:
          return visitJSDocType((node as ts.JSDocNonNullableType).type);
        case ts.SyntaxKind.JSDocNullableType:
          return visitJSDocNullableType(node as ts.JSDocNullableType);
        case ts.SyntaxKind.JSDocVariadicType:
          return visitJSDocVariadicType(node as ts.JSDocVariadicType);
        case ts.SyntaxKind.JSDocFunctionType:
          return visitJSDocFunctionType(node as ts.JSDocFunctionType);
        case ts.SyntaxKind.ArrayType: {
          const elementType = (node as ts.ArrayTypeNode).elementType;
          const visited = visitJSDocType(elementType);
          return factory.createArrayTypeNode(visited);
        }
        case ts.SyntaxKind.TypeReference:
          return visitJSDocTypeReference(node as ts.TypeReferenceNode);
        case ts.SyntaxKind.JSDocTypeLiteral:
          return visitJSDocTypeLiteral(node as ts.JSDocTypeLiteral);
        default:
          return node as ts.TypeNode;
      }
    }

    function visitJSDocNullableType(node: ts.JSDocNullableType) {
      return factory.createUnionTypeNode([
        ts.visitNode(node.type, visitJSDocType) as ts.TypeNode,
        factory.createLiteralTypeNode(factory.createNull()),
      ]);
    }

    function visitJSDocVariadicType(node: ts.JSDocVariadicType) {
      return factory.createArrayTypeNode(ts.visitNode(node.type, visitJSDocType) as ts.TypeNode);
    }

    function visitJSDocFunctionType(node: ts.JSDocFunctionType) {
      return factory.createFunctionTypeNode(
        undefined,
        node.parameters.map(visitJSDocParameter),
        node.type ?? anyType,
      );
    }

    function visitJSDocTypeLiteral(node: ts.JSDocTypeLiteral) {
      const propertySignatures: ts.PropertySignature[] = [];
      if (node.jsDocPropertyTags) {
        node.jsDocPropertyTags.forEach((tag) => {
          const property = visitJSDocPropertyLikeTag(tag);
          if (property) {
            propertySignatures.push(property);
          }
        });
      }
      return factory.createTypeLiteralNode(propertySignatures);
    }

    function visitJSDocPropertyLikeTag(node: ts.JSDocPropertyLikeTag) {
      let optionalType = false;
      let type;
      if (node.typeExpression) {
        type = visitJSDocType(node.typeExpression.type);
        optionalType = ts.isJSDocOptionalType(node.typeExpression);
      } else {
        type = anyType;
      }
      const questionToken =
        node.isBracketed || optionalType
          ? factory.createToken(ts.SyntaxKind.QuestionToken)
          : undefined;
      if (ts.isIdentifier(node.name)) {
        return factory.createPropertySignature(undefined, node.name, questionToken, type);
      }
      // Assumption: the leaf field on the QualifiedName belongs directly to the parent object type.
      return factory.createPropertySignature(undefined, node.name.right, questionToken, type);
    }

    function visitJSDocParameter(node: ts.ParameterDeclaration) {
      if (!node.type) {
        return node;
      }
      const index = node.parent.parameters.indexOf(node);
      const isRest =
        node.type.kind === ts.SyntaxKind.JSDocVariadicType &&
        index === node.parent.parameters.length - 1;
      const name = node.name || (isRest ? 'rest' : `arg${index}`);
      const dotdotdot = isRest
        ? factory.createToken(ts.SyntaxKind.DotDotDotToken)
        : node.dotDotDotToken;

      return factory.createParameterDeclaration(
      node.modifiers,
      dotdotdot,
      name,
      node.questionToken,
      ts.visitNode(node.type, visitJSDocType) as ts.TypeNode,
      node.initializer
      );
    }

    function visitJSDocTypeReference(node: ts.TypeReferenceNode) {
      let name = node.typeName;
      let args = node.typeArguments;

      // Preserve index-signature special case for Object<K,V>
      if (ts.isIdentifier(node.typeName) && isJSDocIndexSignature(node)) {
        return visitJSDocIndexSignature(node);
      }

      if (ts.isIdentifier(node.typeName)) {
        let text = node.typeName.text;
        let acceptsTypeParameters = true;

        if (text in typeMap) {
          const typeOptions = typeMap[text];
          if (typeof typeOptions === 'string') {
            text = typeOptions;
          } else {
            if (typeOptions.tsName) text = typeOptions.tsName;
            acceptsTypeParameters = typeOptions.acceptsTypeParameters !== false;
          }
        }

        // Lower/upper-case primitives become keyword nodes (drop generics)
        const primitive = primitiveKeywordNode(text);
        if (primitive) return primitive;

        // Bare Array/Promise → default to any
        if ((text === 'Array' || text === 'Promise') && !node.typeArguments) {
          return factory.createTypeReferenceNode(text, [anyType]);
        }

        name = factory.createIdentifier(text);

        if (node.typeArguments && acceptsTypeParameters) {
          const normalizedArgs = node.typeArguments.map(arg => {
            const visited = visitJSDocType(arg);
            // Map inner TypeReference(String/Number/Boolean/Object/Symbol) to keyword where possible
            if (ts.isTypeReferenceNode(visited) && ts.isIdentifier(visited.typeName)) {
              const innerPrim = primitiveKeywordNode(visited.typeName.text);
              return innerPrim ?? visited;
            }
            return visited;
          });
          args = factory.createNodeArray(normalizedArgs);
        } else {
          args = undefined;
        }

        return factory.createTypeReferenceNode(name, args);
      }

      return factory.createTypeReferenceNode(name, args);
    }

    function visitJSDocIndexSignature(node: ts.TypeReferenceNode) {
      const typeArguments = node.typeArguments!;
      const index = factory.createParameterDeclaration(
        /* modifiers */ undefined,
        /* dotDotDotToken */ undefined,
        typeArguments[0].kind === ts.SyntaxKind.NumberKeyword ? 'n' : 's',
        /* questionToken */ undefined,
        factory.createTypeReferenceNode(
          typeArguments[0].kind === ts.SyntaxKind.NumberKeyword ? 'number' : 'string',
          [],
        ),
        /* initializer */ undefined,
      );
      const indexSignature = factory.createTypeLiteralNode([
        factory.createIndexSignature(
          /* modifiers */ undefined,
          [index],
          typeArguments[1],
        ),
      ]);
      ts.setEmitFlags(indexSignature, ts.EmitFlags.SingleLine);
      return indexSignature;
    }
  };

const accessibilityMask =
  ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Public;

function modifiersFromJSDoc(
  methodDeclaration: ts.MethodDeclaration,
  factory: ts.NodeFactory,
): ReadonlyArray<ts.Modifier> | undefined {
  let modifierFlags = ts.getCombinedModifierFlags(methodDeclaration);
  if ((modifierFlags & accessibilityMask) !== 0) {
    // Don't overwrite existing accessibility modifier.
    return methodDeclaration.modifiers as unknown as ReadonlyArray<ts.Modifier> | undefined;
  }

  if (ts.getJSDocPrivateTag(methodDeclaration)) {
    modifierFlags |= ts.ModifierFlags.Private;
  } else if (ts.getJSDocProtectedTag(methodDeclaration)) {
    modifierFlags |= ts.ModifierFlags.Protected;
  } else if (ts.getJSDocPublicTag(methodDeclaration)) {
    modifierFlags |= ts.ModifierFlags.Public;
  } else {
    return methodDeclaration.modifiers as unknown as ReadonlyArray<ts.Modifier> | undefined;
  }

  return factory.createModifiersFromModifierFlags(modifierFlags);
}

// Copied from: https://github.com/microsoft/TypeScript/blob/v4.0.2/src/compiler/utilities.ts#L1879
function isJSDocIndexSignature(node: ts.TypeReferenceNode | ts.ExpressionWithTypeArguments) {
  return (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.escapedText === 'Object' &&
    node.typeArguments &&
    node.typeArguments.length === 2 &&
    (node.typeArguments[0].kind === ts.SyntaxKind.StringKeyword ||
      node.typeArguments[0].kind === ts.SyntaxKind.NumberKeyword)
  );
}
