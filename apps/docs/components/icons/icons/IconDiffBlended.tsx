// Generated from svgs/IconDiffBlended.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconDiffBlended = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M16 7.5V2a2 2 0 0 0-2-2H2a2 2 0 0 0-2 2v5.5A.5.5 0 0 0 .5 7a1.5 1.5 0 1 1 3 0 .5.5 0 0 0 1 0 1.5 1.5 0 1 1 3 0 .5.5 0 0 0 1 0 1.5 1.5 0 1 1 3 0 .5.5 0 0 0 1 0 1.5 1.5 0 0 1 3 0 .5.5 0 0 0 .5.5" opacity=".4"/><path d="M14 6.5a.5.5 0 0 1 .5.5A1.5 1.5 0 0 0 16 8.5V14a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V8.5A1.5 1.5 0 0 0 1.5 7a.5.5 0 0 1 1 0 1.5 1.5 0 1 0 3 0 .5.5 0 0 1 1 0 1.5 1.5 0 1 0 3 0 .5.5 0 0 1 1 0 1.5 1.5 0 0 0 3 0 .5.5 0 0 1 .5-.5M10.5 10a.5.5 0 0 0-.5.5v1H9a.5.5 0 0 0 0 1h1v1a.5.5 0 0 0 1 0v-1h1a.5.5 0 0 0 0-1h-1v-1a.5.5 0 0 0-.5-.5M4 11.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1z" clip-rule="evenodd"/></svg>
	);
};

export { IconDiffBlended as ReactComponent };