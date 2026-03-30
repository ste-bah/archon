/**
 * PDFKit Type Declarations
 *
 * Minimal type declarations for PDFKit usage in the PDF generator.
 * Install @types/pdfkit for full type support.
 *
 * @module pdf-generator/types/pdfkit
 */

declare module 'pdfkit' {
  interface PDFDocumentOptions {
    size?: string | [number, number];
    margins?: {
      top?: number;
      bottom?: number;
      left?: number;
      right?: number;
    };
    info?: {
      Title?: string;
      Author?: string;
      Subject?: string;
      Creator?: string;
      Keywords?: string;
      CreationDate?: Date;
      ModDate?: Date;
    };
    autoFirstPage?: boolean;
    bufferPages?: boolean;
    compress?: boolean;
  }

  interface TextOptions {
    align?: 'left' | 'center' | 'right' | 'justify';
    width?: number;
    height?: number;
    ellipsis?: boolean | string;
    columns?: number;
    columnGap?: number;
    indent?: number;
    paragraphGap?: number;
    lineGap?: number;
    wordSpacing?: number;
    characterSpacing?: number;
    fill?: boolean;
    stroke?: boolean;
    link?: string;
    underline?: boolean;
    strike?: boolean;
    continued?: boolean;
    oblique?: boolean | number;
    features?: string[];
  }

  class PDFDocument {
    constructor(options?: PDFDocumentOptions);

    // Properties
    x: number;
    y: number;
    page: {
      width: number;
      height: number;
      margins: {
        top: number;
        bottom: number;
        left: number;
        right: number;
      };
    };

    // Methods
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
    end(): void;

    // Page methods
    addPage(options?: PDFDocumentOptions): this;
    bufferedPageRange(): { start: number; count: number };
    switchToPage(pageNumber: number): this;
    flushPages(): void;

    // Text methods
    font(name: string, size?: number): this;
    fontSize(size: number): this;
    currentLineHeight(includeGap?: boolean): number;
    text(text: string, x?: number, y?: number, options?: TextOptions): this;
    text(text: string, options?: TextOptions): this;
    moveDown(lines?: number): this;
    moveUp(lines?: number): this;

    // Styling
    fillColor(color: string | number[], opacity?: number): this;
    strokeColor(color: string | number[], opacity?: number): this;
    opacity(opacity: number): this;
    fillOpacity(opacity: number): this;
    strokeOpacity(opacity: number): this;
    lineWidth(width: number): this;

    // Drawing
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    rect(x: number, y: number, width: number, height: number): this;
    circle(x: number, y: number, radius: number): this;
    fill(color?: string): this;
    stroke(color?: string): this;

    // Events
    on(event: 'pageAdded', callback: () => void): this;
    on(event: string, callback: (...args: unknown[]) => void): this;

    // Image
    image(
      src: string | Buffer,
      x?: number,
      y?: number,
      options?: {
        width?: number;
        height?: number;
        scale?: number;
        fit?: [number, number];
        cover?: [number, number];
        align?: 'left' | 'center' | 'right';
        valign?: 'top' | 'center' | 'bottom';
        link?: string;
      }
    ): this;

    // Save/Restore state
    save(): this;
    restore(): this;
  }

  export = PDFDocument;
}
