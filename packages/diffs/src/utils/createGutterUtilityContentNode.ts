export function createGutterUtilityContentNode(): HTMLElement {
  const gutterUtilityContent = document.createElement('div');
  gutterUtilityContent.slot = 'gutter-utility-slot';
  gutterUtilityContent.style.position = 'absolute';
  gutterUtilityContent.style.top = '0';
  gutterUtilityContent.style.bottom = '0';
  gutterUtilityContent.style.textAlign = 'center';
  gutterUtilityContent.style.whiteSpace = 'normal';
  return gutterUtilityContent;
}
