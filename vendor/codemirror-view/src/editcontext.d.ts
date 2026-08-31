export interface TextUpdateEvent extends Event {
  readonly updateRangeStart: number
  readonly updateRangeEnd: number
  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

export interface TextFormat {
  readonly rangeStart: number
  readonly rangeEnd: number
  readonly textColor: string
  readonly backgroundColor: string
  readonly underlineStyle: "None" | "Solid" | "Dotted" | "Dashed" | "Squiggle"
  readonly underlineThickness: "None" | "Thin" | "Thick"
  readonly underlineColor: string
}

export interface TextFormatUpdateEvent extends Event {
  getTextFormats(): readonly TextFormat[]
}

export interface CharacterBoundsUpdateEvent extends Event {
  readonly rangeStart: number
  readonly rangeEnd: number
}

export declare class EditContext {
  constructor(options?: {text?: string, selectionStart?: number, selectionEnd?: number})

  updateText(rangeStart: number, rangeEnd: number, text: string): void
  updateSelection(start: number, end: number): void
  updateControlBounds(controlBound: DOMRect): void
  updateSelectionBounds(selectionBound: DOMRect): void
  updateCharacterBounds(rangeStart: number, characterBounds: readonly DOMRect[]): void

  attachedElements(): readonly Element[]

  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly compositionRangeStart: number
  readonly compositionRangeEnd: number
  readonly isInComposition: boolean
  readonly controlBound: DOMRect
  readonly selectionBound: DOMRect
  readonly characterBoundsRangeStart: number
  characterBounds(): readonly DOMRect[]

  addEventListener(type: "textupdate", handler: (event: TextUpdateEvent) => void): void
  addEventListener(type: "textformatupdate", handler: (event: TextFormatUpdateEvent) => void): void
  addEventListener(type: "characterboundsupdate", handler: (event: CharacterBoundsUpdateEvent) => void): void
  addEventListener(type: "compositionstart", handler: (event: CompositionEvent) => void): void
  addEventListener(type: "compositionend", handler: (event: CompositionEvent) => void): void

  removeEventListener(type: string, handler: (event: any) => void): void
}

declare global {
  interface HTMLElement { editContext: EditContext | null }
  interface Window { EditContext: typeof EditContext }
}
