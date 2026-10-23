/**
 * @module drive/docsTypes
 * @description A Google Doc as the Docs API's `documents.get` returns it:
 * the parts of it the converter reads, and no more.
 *
 * Everything is optional, as the API leaves out whatever is empty or zero:
 * an index of 0, a run with no style, a list nested at level 0. Indices
 * count UTF-16 code units, as a JavaScript string does, and each element
 * holds `[startIndex, endIndex)`. The body's indices and each footnote's
 * are counted apart, each from 0.
 */

/**
 * A length, such as an indent.
 *
 * @typedef {Object} Dimension
 * @property {number} [magnitude]
 * @property {string} [unit]
 */

/**
 * How a run of text looks: what it sets apart from its paragraph's named
 * style, which `NamedStyle` holds.
 *
 * @typedef {Object} TextStyle
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {boolean} [strikethrough]
 * @property {{url?: string}} [link] - Only a `url` leaves the Doc; a link to
 *   a heading or a bookmark in it has an id instead
 * @property {{fontFamily?: string}} [weightedFontFamily]
 */

/**
 * What a suggestion touching an element carries: the ids of the suggested
 * edits it is part of.
 *
 * @typedef {Object} Suggested
 * @property {string[]} [suggestedInsertionIds]
 * @property {string[]} [suggestedDeletionIds]
 * @property {Record<string, unknown>} [suggestedTextStyleChanges]
 */

/**
 * @typedef {Suggested & {content?: string, textStyle?: TextStyle}} TextRun
 */

/**
 * A smart chip, a footnote's number, a picture or a break: anything in a
 * paragraph that is not text. Each is one index wide.
 *
 * @typedef {Suggested & {textStyle?: TextStyle} & Record<string, any>} InlineElement
 */

/**
 * @typedef {Object} ParagraphElement
 * @property {number} [startIndex]
 * @property {number} [endIndex]
 * @property {TextRun} [textRun]
 * @property {InlineElement} [person] - `personProperties: {name, email}`
 * @property {InlineElement} [richLink] - `richLinkProperties: {title, uri}`
 * @property {InlineElement} [dateElement] - `dateElementProperties: {displayText}`
 * @property {InlineElement} [footnoteReference] - `footnoteId`, `footnoteNumber`
 * @property {InlineElement} [inlineObjectElement] - A picture or a drawing
 * @property {InlineElement} [horizontalRule]
 * @property {InlineElement} [pageBreak]
 * @property {InlineElement} [columnBreak]
 * @property {InlineElement} [equation]
 * @property {InlineElement} [autoText]
 */

/**
 * @typedef {Object} ParagraphStyle
 * @property {string} [namedStyleType] - `NORMAL_TEXT`, `TITLE`, `SUBTITLE`,
 *   `HEADING_1` to `HEADING_6`
 * @property {Dimension} [indentStart]
 * @property {Dimension} [indentFirstLine]
 */

/**
 * @typedef {Object} Bullet
 * @property {string} [listId]
 * @property {number} [nestingLevel]
 */

/**
 * @typedef {Object} Paragraph
 * @property {ParagraphElement[]} [elements] - The last run's text ends with
 *   the paragraph's newline
 * @property {ParagraphStyle} [paragraphStyle]
 * @property {Bullet} [bullet] - Present on a list's paragraphs
 * @property {string[]} [positionedObjectIds] - Pictures placed beside it
 * @property {Record<string, unknown>} [suggestedParagraphStyleChanges]
 * @property {Record<string, unknown>} [suggestedBulletChanges]
 */

/**
 * @typedef {Object} TableCell
 * @property {number} [startIndex]
 * @property {number} [endIndex]
 * @property {StructuralElement[]} [content]
 * @property {{rowSpan?: number, columnSpan?: number}} [tableCellStyle] - A
 *   merged cell spans more than one
 */

/**
 * @typedef {Object} TableRow
 * @property {number} [startIndex]
 * @property {number} [endIndex]
 * @property {TableCell[]} [tableCells]
 */

/**
 * @typedef {Object} Table
 * @property {TableRow[]} [tableRows]
 */

/**
 * A block of a body, a cell, or a footnote.
 *
 * @typedef {Object} StructuralElement
 * @property {number} [startIndex]
 * @property {number} [endIndex]
 * @property {Paragraph} [paragraph]
 * @property {Table} [table]
 * @property {Object} [sectionBreak]
 * @property {Object} [tableOfContents]
 */

/**
 * How one level of a list is numbered: an ordered list's `glyphType` says
 * how (`DECIMAL`, `ALPHA`, `ROMAN`, …); a bulleted one has a `glyphSymbol`.
 *
 * @typedef {Object} NestingLevel
 * @property {string} [glyphType]
 * @property {string} [glyphSymbol]
 * @property {number} [startNumber]
 */

/**
 * @typedef {Object} List
 * @property {{nestingLevels?: NestingLevel[]}} [listProperties]
 */

/**
 * @typedef {Object} NamedStyle
 * @property {string} [namedStyleType]
 * @property {TextStyle} [textStyle]
 */

/**
 * What a tab holds; a Doc read without its tabs holds the same at its top.
 *
 * @typedef {Object} DocumentTab
 * @property {{content?: StructuralElement[]}} [body]
 * @property {Record<string, {content?: StructuralElement[]}>} [footnotes]
 * @property {Record<string, List>} [lists]
 * @property {{styles?: NamedStyle[]}} [namedStyles]
 * @property {Record<string, InlineObject>} [inlineObjects] - By id: what an
 *   `inlineObjectElement` shows
 * @property {Record<string, CommentAnchor>} [commentAnchors] - By id: where
 *   the Doc's comment threads are in this tab
 */

/**
 * Where a comment thread is: the stretches of a tab it is on.
 *
 * @typedef {Object} CommentAnchor
 * @property {string} [anchorId]
 * @property {Array<{startIndex?: number, endIndex?: number, segmentId?: string, tabId?: string}>} [ranges]
 */

/**
 * Someone who said something in a comment thread. `me` is the account the
 * token is for; Google gives no address.
 *
 * @typedef {Object} CommentAuthor
 * @property {string} [displayName]
 * @property {string} [user] - Google's id for them
 * @property {boolean} [me]
 */

/**
 * One thing said in a comment thread, or a resolve or reopen with nothing said.
 *
 * @typedef {Object} DocPost
 * @property {string} [postId]
 * @property {CommentAuthor} [author]
 * @property {string} [content]
 * @property {string} [createTime]
 * @property {string} [updateTime]
 * @property {string} [commentAction] - `RESOLVE`, `REOPEN`, or none
 */

/**
 * A comment thread of the Doc's.
 *
 * @typedef {Object} DocComment
 * @property {string} commentId
 * @property {string} [anchorId] - Its place, in a tab's `commentAnchors`
 * @property {string} [status] - `OPEN` or `RESOLVED`
 * @property {DocPost} [headPost]
 * @property {DocPost[]} [replies]
 * @property {string} [plainTextQuote] - The words it was on
 */

/**
 * A suggested edit's thread in the Doc. Its head post is the change, said by
 * whoever suggested it, with no words; its replies are what was said on it.
 *
 * @typedef {Object} DocSuggestion
 * @property {string} suggestionId - As the text's suggested runs name it
 * @property {'OPEN'|'ACCEPTED'|'REJECTED'} [status] - Listed still once it is
 *   accepted or rejected, and not once its author deletes it
 * @property {DocPost} [headPost]
 * @property {DocPost[]} [replies]
 * @property {string} [summaryText] - What it changes, in Docs' words
 */

/**
 * A picture or a drawing in a paragraph. A picture has the address it can
 * be fetched from, for half an hour after the read; a drawing has none.
 *
 * @typedef {Object} InlineObject
 * @property {{embeddedObject?: {
 *   imageProperties?: {contentUri?: string},
 *   title?: string,
 *   description?: string,
 * }}} [inlineObjectProperties]
 */

/**
 * @typedef {Object} Tab
 * @property {{tabId?: string, title?: string}} [tabProperties]
 * @property {DocumentTab} [documentTab]
 * @property {Tab[]} [childTabs]
 */

/**
 * @typedef {DocumentTab & {documentId?: string, title?: string, revisionId?: string, tabs?: Tab[], comments?: DocComment[], suggestions?: DocSuggestion[]}} Document
 */

export {}
