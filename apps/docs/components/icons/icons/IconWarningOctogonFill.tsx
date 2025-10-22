// Generated from svgs/IconWarningOctogonFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconWarningOctogonFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M4.393.293A1 1 0 0 1 5.101 0H10.9a1 1 0 0 1 .707.293l4.1 4.1a1 1 0 0 1 .293.708V10.9a1 1 0 0 1-.293.707l-4.1 4.1A1 1 0 0 1 10.9 16H5.1a1 1 0 0 1-.707-.293l-4.1-4.1A1 1 0 0 1 0 10.9V5.1a1 1 0 0 1 .293-.707zm2.612 4.806a1 1 0 1 1 1.99 0L8.607 8.95a.61.61 0 0 1-1.214 0zM8 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2" clip-rule="evenodd"/></svg>
	);
};

export { IconWarningOctogonFill as ReactComponent };