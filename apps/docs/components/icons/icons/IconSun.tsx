// Generated from svgs/IconSun.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSun = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M8.21 2.109a.256.256 0 0 0-.42 0L6.534 3.893a.256.256 0 0 1-.316.085l-1.982-.917a.256.256 0 0 0-.362.21l-.196 2.174a.256.256 0 0 1-.232.232l-2.175.196a.256.256 0 0 0-.209.362l.917 1.982a.256.256 0 0 1-.085.316L.11 9.791a.256.256 0 0 0 0 .418L1.23 11H3.1a5 5 0 1 1 9.8 0h1.869l1.123-.79a.256.256 0 0 0 0-.42l-1.785-1.257a.256.256 0 0 1-.085-.316l.917-1.982a.256.256 0 0 0-.21-.362l-2.174-.196a.256.256 0 0 1-.232-.232l-.196-2.175a.256.256 0 0 0-.362-.209l-1.982.917a.256.256 0 0 1-.316-.085z" /><path d="M4 10q.001.519.126 1h7.748A4 4 0 1 0 4 10M.75 12a.75.75 0 0 0 0 1.5h14.5a.75.75 0 0 0 0-1.5z" /></svg>
	);
};

export { IconSun as ReactComponent };
