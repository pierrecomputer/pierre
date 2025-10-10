// Generated from svgs/IconSwitches.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSwitches = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M11.25 0h-6.5a3.75 3.75 0 1 0 0 7.5h6.5a3.75 3.75 0 1 0 0-7.5m2.25 3.75a2.25 2.25 0 0 0-2.25-2.25H8.058c.437.641.692 1.416.692 2.25S8.495 5.359 8.058 6h3.192a2.25 2.25 0 0 0 2.25-2.25m-6.25 0a2.5 2.5 0 1 0-5-.001 2.5 2.5 0 0 0 5 .001M4.75 8.5a3.75 3.75 0 1 0 0 7.5h6.5a3.75 3.75 0 1 0 0-7.5zm4 3.75a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0" clipRule="evenodd" /></svg>
	);
};

export { IconSwitches as ReactComponent };
