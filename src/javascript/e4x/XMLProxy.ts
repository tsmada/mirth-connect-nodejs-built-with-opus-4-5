/**
 * Ported from: E4X XML object behavior in Mozilla Rhino
 *
 * Purpose: E4X-compatible XML wrapper for Mirth scripts
 *
 * Key behaviors to replicate:
 * - Path-based get/set: msg['PID']['PID.5']
 * - Array indexing: msg['OBX'][0]
 * - Descendant access: msg..OBX
 * - Iteration: for each (seg in msg.children())
 * - String conversion: toString(), toXMLString()
 * - Deletion: delete msg['OBX'][0]
 * - Concatenation: msg['PID'] += segment
 */

import { XMLParser, XMLBuilder, XmlBuilderOptions } from 'fast-xml-parser';

// Parser options for XML parsing
const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '__cdata',
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
};

// Builder options for XML serialization
const builderOptions: XmlBuilderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '__cdata',
  preserveOrder: true,
  format: false,
  suppressEmptyNode: false,
};

const parser = new XMLParser(parserOptions);
const builder = new XMLBuilder(builderOptions);

/**
 * Internal node structure for preserveOrder mode
 */
interface OrderedNode {
  [tagName: string]: OrderedNode[] | string | { [attr: string]: string } | undefined;
}

/**
 * XMLProxy - E4X-compatible XML wrapper
 *
 * Provides Mirth-style XML access patterns:
 * - msg['PID']['PID.5']['PID.5.1']
 * - msg..OBX (descendants)
 * - for each (seg in msg.children())
 */
export class XMLProxy {
  private nodes: OrderedNode[];
  private _parent: XMLProxy | null;
  private tagName: string;
  private defaultNamespace: string = '';

  private constructor(
    nodes: OrderedNode[],
    tagName: string = '',
    parent: XMLProxy | null = null
  ) {
    this.nodes = nodes;
    this.tagName = tagName;
    this._parent = parent;

    // Return a Proxy to intercept property access
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        // Handle built-in methods and properties first
        if (typeof prop === 'symbol') {
          if (prop === Symbol.iterator) {
            return target[Symbol.iterator].bind(target);
          }
          if (prop === Symbol.toPrimitive) {
            return () => target.toString();
          }
          return Reflect.get(target, prop, receiver);
        }

        // Handle numeric indices for XMLList-style access
        if (typeof prop === 'string' && !isNaN(Number(prop))) {
          return target.getIndex(Number(prop));
        }

        // Handle method calls - check prototype chain and bind to target
        if (typeof prop === 'string') {
          const value = (target as Record<string, unknown>)[prop];
          if (typeof value === 'function') {
            return (value as Function).bind(target);
          }
        }

        // Handle property access (E4X style)
        if (typeof prop === 'string') {
          return target.get(prop);
        }

        return Reflect.get(target, prop, receiver);
      },

      set: (target, prop, value) => {
        if (typeof prop === 'string' && !isNaN(Number(prop))) {
          target.setIndex(Number(prop), value);
          return true;
        }

        if (typeof prop === 'string') {
          target.set(prop, value);
          return true;
        }

        return Reflect.set(target, prop, value);
      },

      deleteProperty: (target, prop) => {
        if (typeof prop === 'string' && !isNaN(Number(prop))) {
          target.deleteAt(Number(prop));
        } else if (typeof prop === 'string') {
          target.removeChild(prop);
        }
        return true;
      },
    });
  }

  /**
   * Create XMLProxy from XML string
   */
  static create(xmlString: string): XMLProxy {
    if (!xmlString || xmlString.trim() === '') {
      return new XMLProxy([], '');
    }

    try {
      const parsed = parser.parse(xmlString) as OrderedNode[];
      return new XMLProxy(Array.isArray(parsed) ? parsed : [parsed], 'root');
    } catch {
      // Return empty proxy on parse error
      return new XMLProxy([], '');
    }
  }

  /**
   * Create empty XMLProxy
   */
  static createEmpty(): XMLProxy {
    return new XMLProxy([], '');
  }

  /**
   * Create XMLList (array of XMLProxy)
   * Accepts optional string argument for parsing (E4X: new XMLList(str))
   */
  static createList(str?: string): XMLProxy {
    if (str !== undefined && str !== null && str !== '') {
      return XMLProxy.create(str);
    }
    return new XMLProxy([], 'list');
  }

  /**
   * Get child element by name (E4X property access)
   */
  get(name: string): XMLProxy {
    const result: OrderedNode[] = [];

    for (const node of this.nodes) {
      const children = this.getChildrenOfNode(node, name);
      result.push(...children);
    }

    return new XMLProxy(result, name, this);
  }

  /**
   * Get element by index
   */
  getIndex(index: number): XMLProxy {
    if (index >= 0 && index < this.nodes.length) {
      return new XMLProxy([this.nodes[index]!], this.tagName, this._parent);
    }
    return new XMLProxy([], this.tagName, this._parent);
  }

  /**
   * Set child element value
   */
  set(name: string, value: unknown): void {
    if (this.nodes.length === 0) {
      return;
    }

    const node = this.nodes[0]!;
    const tagName = this.getNodeTagName(node);

    if (tagName) {
      const children = node[tagName] as OrderedNode[];
      if (Array.isArray(children)) {
        // Find or create child with this name
        let found = false;
        for (const child of children) {
          if (this.getNodeTagName(child) === name) {
            this.setNodeValue(child, name, value);
            found = true;
            break;
          }
        }

        if (!found) {
          // Create new child
          const newChild: OrderedNode = {};
          if (value instanceof XMLProxy) {
            newChild[name] = value.nodes;
          } else {
            newChild[name] = [{ '#text': String(value) }];
          }
          children.push(newChild);
        }
      }
    }
  }

  /**
   * Set value at index
   */
  setIndex(index: number, value: unknown): void {
    if (index >= 0 && index < this.nodes.length) {
      if (value instanceof XMLProxy) {
        this.nodes[index] = value.nodes[0] ?? {};
      } else {
        const tagName = this.getNodeTagName(this.nodes[index]!);
        if (tagName) {
          this.nodes[index]![tagName] = [{ '#text': String(value) }];
        }
      }
    }
  }

  /**
   * Delete element at index
   */
  deleteAt(index: number): boolean {
    if (index >= 0 && index < this.nodes.length) {
      this.nodes.splice(index, 1);

      // Also remove from parent if we have one
      if (this._parent && this.tagName) {
        this._parent.removeChildByName(this.tagName, index);
      }

      return true;
    }
    return false;
  }

  /**
   * Remove child by name and index from parent
   */
  private removeChildByName(name: string, index: number): void {
    for (const node of this.nodes) {
      const tagName = this.getNodeTagName(node);
      if (tagName) {
        const children = node[tagName] as OrderedNode[];
        if (Array.isArray(children)) {
          let nameIndex = 0;
          for (let i = 0; i < children.length; i++) {
            if (this.getNodeTagName(children[i]!) === name) {
              if (nameIndex === index) {
                children.splice(i, 1);
                return;
              }
              nameIndex++;
            }
          }
        }
      }
    }
  }

  /**
   * Remove all children with given name
   */
  removeChild(name: string): void {
    for (const node of this.nodes) {
      const tagName = this.getNodeTagName(node);
      if (tagName) {
        const children = node[tagName] as OrderedNode[];
        if (Array.isArray(children)) {
          // Remove all children matching the name
          for (let i = children.length - 1; i >= 0; i--) {
            if (this.getNodeTagName(children[i]!) === name) {
              children.splice(i, 1);
            }
          }
        }
      }
    }
  }

  /**
   * Filter elements by predicate (E4X filtering predicate)
   *
   * Transpiled from: msg.OBX.(OBX.3 == 'WBC')
   * Into: msg.get('OBX').filter(function(__e4x_item) { with(__e4x_item) { return (OBX.3 == 'WBC'); } })
   */
  filter(predicate: (item: XMLProxy) => boolean): XMLProxy {
    const result: OrderedNode[] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const item = new XMLProxy([this.nodes[i]!], this.tagName, this._parent);
      if (predicate(item)) {
        result.push(this.nodes[i]!);
      }
    }
    return new XMLProxy(result, this.tagName, this._parent);
  }

  /**
   * Get all descendants with name (E4X .. operator)
   */
  descendants(name?: string): XMLProxy {
    const result: OrderedNode[] = [];
    this.collectDescendants(this.nodes, name, result);
    return new XMLProxy(result, name ?? 'descendants', this);
  }

  private collectDescendants(nodes: OrderedNode[], name: string | undefined, result: OrderedNode[]): void {
    for (const node of nodes) {
      const tagName = this.getNodeTagName(node);

      if (tagName) {
        if (!name || tagName === name) {
          result.push(node);
        }

        const children = node[tagName];
        if (Array.isArray(children)) {
          this.collectDescendants(children as OrderedNode[], name, result);
        }
      }
    }
  }

  /**
   * Get child nodes (excludes text nodes)
   */
  children(): XMLProxy {
    const result: OrderedNode[] = [];

    for (const node of this.nodes) {
      const tagName = this.getNodeTagName(node);
      if (tagName) {
        const children = node[tagName];
        if (Array.isArray(children)) {
          // Filter out text nodes - only include element nodes
          for (const child of children as OrderedNode[]) {
            if (!('#text' in child)) {
              result.push(child);
            }
          }
        }
      }
    }

    return new XMLProxy(result, 'children', this);
  }

  /**
   * Get parent node
   */
  parent(): XMLProxy | null {
    return this._parent;
  }

  /**
   * Get element name
   */
  name(): { localName: string; toString: () => string } {
    const localName = this.nodes.length > 0 ? this.getNodeTagName(this.nodes[0]!) : '';
    return {
      localName,
      toString: () => localName,
    };
  }

  /**
   * Get/set namespace
   *
   * When called with a string argument, looks up namespace URI by prefix:
   *   namespace('')     → default namespace (xmlns="...")
   *   namespace('hl7')  → prefixed namespace (xmlns:hl7="...")
   *
   * When called with no arguments, returns default namespace.
   */
  namespace(prefix?: string): string | void {
    if (prefix !== undefined) {
      // When called with a string argument, look up namespace by prefix
      // namespace('') returns the default namespace
      // namespace('hl7') returns the namespace for prefix 'hl7'
      const nsUri = this.extractNamespaceUri(prefix);
      if (nsUri !== undefined) {
        return nsUri;
      }
      // Fall back to stored default or set it
      if (prefix === '') {
        return this.defaultNamespace;
      }
      // For non-empty prefix with no match, return undefined
      return undefined;
    } else {
      // No argument: return default namespace
      const defaultNs = this.extractNamespaceUri('');
      return defaultNs !== undefined ? defaultNs : this.defaultNamespace;
    }
  }

  /**
   * Set default namespace
   */
  setDefaultNamespace(ns: string): void {
    this.defaultNamespace = ns;
  }

  /**
   * Extract namespace URI from xmlns attributes on the element
   */
  private extractNamespaceUri(prefix: string): string | undefined {
    if (this.nodes.length === 0) return undefined;

    const node = this.nodes[0]!;
    const attrs = node[':@'] as Record<string, string> | undefined;
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return undefined;

    if (prefix === '') {
      // Look for default namespace: @_xmlns
      return attrs['@_xmlns'];
    } else {
      // Look for prefixed namespace: @_xmlns:prefix
      return attrs[`@_xmlns:${prefix}`];
    }
  }

  /**
   * Get attribute value
   */
  attr(name: string): string | undefined {
    if (this.nodes.length === 0) return undefined;

    const node = this.nodes[0]!;
    const attrs = node[':@'] as Record<string, string> | undefined;
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
      return attrs[`@_${name}`];
    }
    return undefined;
  }

  /**
   * Set attribute value
   */
  setAttr(name: string, value: string): void {
    if (this.nodes.length === 0) return;

    const node = this.nodes[0]!;
    if (!node[':@']) {
      node[':@'] = {} as Record<string, string>;
    }
    (node[':@'] as Record<string, string>)[`@_${name}`] = value;
  }

  /**
   * Get all attributes
   */
  attributes(): Record<string, string> {
    if (this.nodes.length === 0) return {};

    const node = this.nodes[0]!;
    const attrs = node[':@'] as Record<string, string> | undefined;
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(attrs)) {
        if (key.startsWith('@_')) {
          result[key.substring(2)] = value;
        }
      }
      return result;
    }
    return {};
  }

  /**
   * Get length (for XMLList)
   */
  length(): number {
    return this.nodes.length;
  }

  /**
   * Check if has simple content (text only)
   */
  hasSimpleContent(): boolean {
    if (this.nodes.length === 0) return true;
    if (this.nodes.length > 1) return false;

    const node = this.nodes[0]!;
    const tagName = this.getNodeTagName(node);
    if (!tagName) return true;

    const children = node[tagName];
    if (!Array.isArray(children)) return true;

    // Simple content if only text node children
    return children.every((child) => '#text' in (child as OrderedNode));
  }

  /**
   * Check if has complex content (child elements)
   */
  hasComplexContent(): boolean {
    return !this.hasSimpleContent();
  }

  /**
   * Get text content (E4X text() method)
   */
  text(): string {
    return this.toString();
  }

  /**
   * Get only element children (exclude text nodes) - E4X elements() method
   */
  elements(): XMLProxy {
    const result: OrderedNode[] = [];
    for (const node of this.nodes) {
      const tagName = this.getNodeTagName(node);
      if (tagName) {
        const children = node[tagName];
        if (Array.isArray(children)) {
          for (const child of children as OrderedNode[]) {
            if (!('#text' in child)) {
              result.push(child);
            }
          }
        }
      }
    }
    return new XMLProxy(result, 'elements', this);
  }

  /**
   * Return comment nodes (E4X comments() method).
   * Stub: fast-xml-parser doesn't preserve comments with preserveOrder, so return empty.
   */
  comments(): XMLProxy {
    return new XMLProxy([], 'comments', this);
  }

  /**
   * Return processing instruction nodes (E4X processingInstructions() method).
   * Stub: rarely used in Mirth scripts, returns empty to avoid TypeError.
   */
  processingInstructions(): XMLProxy {
    return new XMLProxy([], 'processingInstructions', this);
  }

  /**
   * Convert to string (text content only)
   */
  toString(): string {
    if (this.nodes.length === 0) return '';

    const texts: string[] = [];
    this.collectText(this.nodes, texts);
    return texts.join('');
  }

  private collectText(nodes: OrderedNode[], texts: string[]): void {
    for (const node of nodes) {
      if ('#text' in node) {
        texts.push(String(node['#text']));
      } else if ('__cdata' in node) {
        // CDATA is stored as __cdata: [{ "#text": "content" }] by fast-xml-parser
        const cdataChildren = node['__cdata'];
        if (Array.isArray(cdataChildren)) {
          this.collectText(cdataChildren as OrderedNode[], texts);
        } else if (typeof cdataChildren === 'string') {
          texts.push(cdataChildren);
        }
      } else {
        const tagName = this.getNodeTagName(node);
        if (tagName) {
          const children = node[tagName];
          if (Array.isArray(children)) {
            this.collectText(children as OrderedNode[], texts);
          } else if (typeof children === 'string') {
            texts.push(children);
          }
        }
      }
    }
  }

  /**
   * Convert to XML string (full XML)
   */
  toXMLString(): string {
    if (this.nodes.length === 0) return '';

    try {
      return builder.build(this.nodes);
    } catch {
      return '';
    }
  }

  /**
   * Append XML (E4X += operator)
   */
  append(value: XMLProxy | string): XMLProxy {
    if (typeof value === 'string') {
      const parsed = XMLProxy.create(value);
      this.nodes.push(...parsed.getNodes());
    } else {
      this.nodes.push(...value.getNodes());
    }
    return this;
  }

  /**
   * Insert child after specified node
   */
  insertChildAfter(refChild: XMLProxy, newChild: XMLProxy): XMLProxy {
    if (this.nodes.length === 0) return this;

    const node = this.nodes[0]!;
    const tagName = this.getNodeTagName(node);
    if (!tagName) return this;

    const children = node[tagName];
    if (!Array.isArray(children)) return this;

    const refIndex = refChild.childIndex();
    if (refIndex >= 0 && refIndex < children.length) {
      children.splice(refIndex + 1, 0, ...newChild.getNodes());
    }

    return this;
  }

  /**
   * Get child index in parent
   */
  childIndex(): number {
    if (!this._parent || this.nodes.length === 0) return -1;

    const parentChildren = this._parent.children();
    for (let i = 0; i < parentChildren.length(); i++) {
      if (parentChildren.getIndex(i).nodes[0] === this.nodes[0]) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Make iterable for for-each loops
   */
  *[Symbol.iterator](): Iterator<XMLProxy> {
    for (let i = 0; i < this.nodes.length; i++) {
      yield new XMLProxy([this.nodes[i]!], this.tagName, this);
    }
  }

  /**
   * E4X copy() — deep clone of the XML node
   */
  copy(): XMLProxy {
    if (this.nodes.length === 0) return new XMLProxy([], this.tagName);
    const cloned = JSON.parse(JSON.stringify(this.nodes)) as OrderedNode[];
    return new XMLProxy(cloned, this.tagName);
  }

  /**
   * E4X replace(propertyName, value) — replace a named child element
   */
  replace(propertyName: string, value: XMLProxy | string): XMLProxy {
    if (this.nodes.length === 0) return this;

    const node = this.nodes[0]!;
    const tagName = this.getNodeTagName(node);
    if (!tagName) return this;

    const children = node[tagName];
    if (!Array.isArray(children)) return this;

    const idx = children.findIndex((child) => {
      const ct = this.getNodeTagName(child as OrderedNode);
      return ct === propertyName;
    });

    if (idx === -1) return this;

    if (value instanceof XMLProxy && value.getNodes().length > 0) {
      children.splice(idx, 1, ...value.getNodes());
    } else {
      children[idx] = { [propertyName]: [{ '#text': String(value) }] } as unknown as OrderedNode;
    }

    return this;
  }

  /**
   * E4X insertChildBefore(refChild, newChild) — insert before reference node
   */
  insertChildBefore(refChild: XMLProxy, newChild: XMLProxy | string): XMLProxy {
    if (this.nodes.length === 0) return this;

    const node = this.nodes[0]!;
    const tagName = this.getNodeTagName(node);
    if (!tagName) return this;

    const children = node[tagName];
    if (!Array.isArray(children)) return this;

    // Use getNodes() instead of .nodes — .nodes goes through the Proxy get trap
    const newNodes = typeof newChild === 'string'
      ? XMLProxy.create(newChild).getNodes()
      : newChild.getNodes();

    const refNodes = refChild.getNodes();
    if (refNodes.length === 0) {
      // No reference → prepend
      children.unshift(...newNodes);
    } else {
      const refIdx = children.indexOf(refNodes[0] as OrderedNode);
      if (refIdx >= 0) {
        children.splice(refIdx, 0, ...newNodes);
      } else {
        // Reference not found → prepend
        children.unshift(...newNodes);
      }
    }

    return this;
  }

  /**
   * E4X prependChild(child) — insert child at the beginning
   */
  prependChild(child: XMLProxy | string): XMLProxy {
    if (this.nodes.length === 0) return this;

    const node = this.nodes[0]!;
    const tagName = this.getNodeTagName(node);
    if (!tagName) return this;

    const children = node[tagName];
    if (!Array.isArray(children)) return this;

    // Use getNodes() instead of .nodes — .nodes goes through the Proxy get trap
    const newNodes = typeof child === 'string'
      ? XMLProxy.create(child).getNodes()
      : child.getNodes();

    children.unshift(...newNodes);
    return this;
  }

  /**
   * E4X contains(value) — check if this XML contains a value
   */
  contains(value: XMLProxy | string): boolean {
    if (typeof value === 'string') {
      return this.toString() === value;
    }
    if (value.getNodes().length === 0) return false;
    const targetStr = value.toXMLString();
    for (const node of this.nodes) {
      const nodeProxy = new XMLProxy([node], this.tagName);
      if (nodeProxy.toXMLString() === targetStr) return true;
    }
    return false;
  }

  /**
   * E4X nodeKind() — return the kind of this node
   */
  nodeKind(): string {
    return 'element';
  }

  /**
   * E4X localName() — return the local name without namespace prefix
   */
  localName(): string {
    if (this.nodes.length === 0) return '';
    const node = this.nodes[0]!;
    const tag = this.getNodeTagName(node);
    if (!tag) return '';
    const colonIdx = tag.indexOf(':');
    return colonIdx >= 0 ? tag.substring(colonIdx + 1) : tag;
  }

  /**
   * E4X normalize() — normalize adjacent text nodes (noop for fast-xml-parser)
   */
  normalize(): XMLProxy {
    return this;
  }

  /**
   * Convert XML to a JSON-compatible object
   */
  toJSON(): Record<string, unknown> | null {
    if (this.nodes.length === 0) return null;

    const node = this.nodes[0]!;
    const tagName = this.getNodeTagName(node);
    if (!tagName) return null;

    const result: Record<string, unknown> = {};

    // Add attributes
    const attrs = node[':@'] as Record<string, string> | undefined;
    if (attrs) {
      for (const [key, val] of Object.entries(attrs)) {
        result[key.replace('@_', '@')] = val;
      }
    }

    // Add children
    const children = node[tagName];
    if (Array.isArray(children)) {
      for (const child of children) {
        const childNode = child as OrderedNode;
        const childTag = this.getNodeTagName(childNode);
        if (childTag) {
          const childProxy = new XMLProxy([childNode], childTag);
          const childChildren = childNode[childTag];
          if (Array.isArray(childChildren) && childChildren.length === 1 && (childChildren[0] as OrderedNode)['#text'] !== undefined) {
            result[childTag] = (childChildren[0] as OrderedNode)['#text'];
          } else {
            result[childTag] = childProxy.toJSON();
          }
        } else if (childNode['#text'] !== undefined) {
          result['#text'] = childNode['#text'];
        }
      }
    }

    return result;
  }

  /**
   * Get the underlying nodes (for debugging)
   */
  getNodes(): OrderedNode[] {
    return this.nodes;
  }

  // Helper methods

  private getNodeTagName(node: OrderedNode): string {
    for (const key of Object.keys(node)) {
      if (key !== ':@' && key !== '#text' && key !== '__cdata') {
        return key;
      }
    }
    return '';
  }

  private getChildrenOfNode(node: OrderedNode, name: string): OrderedNode[] {
    const result: OrderedNode[] = [];
    const tagName = this.getNodeTagName(node);

    if (tagName) {
      const children = node[tagName];
      if (Array.isArray(children)) {
        for (const child of children) {
          const childTag = this.getNodeTagName(child as OrderedNode);
          if (childTag === name) {
            result.push(child as OrderedNode);
          }
        }
      }
    }

    return result;
  }

  private setNodeValue(node: OrderedNode, tagName: string, value: unknown): void {
    if (value instanceof XMLProxy) {
      node[tagName] = value.nodes;
    } else {
      node[tagName] = [{ '#text': String(value) }];
    }
  }
}

// Type augmentation to satisfy typeof checks
export type XML = XMLProxy;
export const XML = XMLProxy;

/**
 * Global function to create XML from string (matches E4X 'new XML()')
 */
export function createXML(xmlString: string): XMLProxy {
  return XMLProxy.create(xmlString);
}

/**
 * Default namespace tracking
 */
let globalDefaultNamespace = '';

export function setDefaultXmlNamespace(ns: string): void {
  globalDefaultNamespace = ns;
}

export function getDefaultXmlNamespace(): string {
  return globalDefaultNamespace;
}
