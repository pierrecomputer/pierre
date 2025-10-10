// Generated from svgs/IconCopyFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCopyFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M2.25 4h.25v5.75a3.75 3.75 0 0 0 3.75 3.75H12v.25A2.25 2.25 0 0 1 9.75 16h-7.5A2.25 2.25 0 0 1 0 13.75v-7.5A2.25 2.25 0 0 1 2.25 4" opacity=".4" /><path d="M16 9.75A2.25 2.25 0 0 1 13.75 12h-7.5A2.25 2.25 0 0 1 4 9.75v-7.5A2.25 2.25 0 0 1 6.25 0h7.5A2.25 2.25 0 0 1 16 2.25z" /></svg>
	);
};

export { IconCopyFill as ReactComponent };
