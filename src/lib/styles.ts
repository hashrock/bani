/**
 * ToggleGroup の選択中の項目をアクセント色（黒地）で塗る。
 * shadcn/ui の既定は薄いグレーで、選択中かどうかが読み取りにくいので上書きする
 */
export const solidOnClass =
  'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground'
