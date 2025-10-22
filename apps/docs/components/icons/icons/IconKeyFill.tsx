// Generated from svgs/IconKeyFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconKeyFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M4.5 4c1.56 0 2.933.796 3.74 2h6.01l.085.005a.75.75 0 0 1 .5.276l1 1.25a.75.75 0 0 1 .05.866l-1.25 2a.75.75 0 0 1-.97.274l-1.061-.531-1.123.936a.75.75 0 0 1-.961 0L9.229 10h-.486A4.5 4.5 0 1 1 4.5 4m-1 3.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2" clip-rule="evenodd"/></svg>
	);
};

export { IconKeyFill as ReactComponent };