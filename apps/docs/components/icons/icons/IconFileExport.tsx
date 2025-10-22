// Generated from svgs/IconFileExport.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFileExport = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M10.336 0c.464 0 .91.185 1.237.513l2.621 2.62A2.75 2.75 0 0 1 15 5.079v8.172A2.75 2.75 0 0 1 12.25 16h-8.5A2.75 2.75 0 0 1 1 13.25V2.75A2.75 2.75 0 0 1 3.75 0zM3.75 1.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25V5.078c0-.331-.132-.65-.366-.884l-2.621-2.62a.25.25 0 0 0-.177-.074z"/><path stroke="#000" stroke-linejoin="round" stroke-width="1.5" d="M12 4.5h1.5V4L11 1v2.5a1 1 0 0 0 1 1Zm0 0V3"/><path d="M8.22 5.72a.75.75 0 0 0 0 1.06L9.44 8H4.75a.75.75 0 0 0 0 1.5h4.69l-1.22 1.22a.75.75 0 1 0 1.06 1.06l2.5-2.5a.75.75 0 0 0 0-1.06l-2.5-2.5a.75.75 0 0 0-1.06 0"/></svg>
	);
};

export { IconFileExport as ReactComponent };