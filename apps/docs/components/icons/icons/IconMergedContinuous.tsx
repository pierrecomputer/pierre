// Generated from svgs/IconMergedContinuous.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconMergedContinuous = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 0.9411764705882353);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 17" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M1.012.675A.75.75 0 0 1 2.288.22L3.51 1.44A8 8 0 1 1 0 7.923a.75.75 0 1 1 1.5.025c-.01.592.061 1.196.222 1.798a6.5 6.5 0 0 0 1.305 2.504c1.335-.008 2.298-.593 2.984-1.371A5.7 5.7 0 0 0 7.25 8.423V6.56L6.03 7.78A.75.75 0 0 1 4.97 6.72l2.5-2.5a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 1 1-1.06 1.06L8.75 6.56v1.863c.156.72.553 1.68 1.238 2.456.686.779 1.65 1.364 2.987 1.37a6.5 6.5 0 0 0-8.38-9.724l.875.877a.75.75 0 0 1-.455 1.276l-3.536.354a.75.75 0 0 1-.82-.821zM11.49 13.55c-1.106-.308-1.976-.938-2.629-1.679A6.8 6.8 0 0 1 8 10.633a6.8 6.8 0 0 1-.862 1.238c-.653.74-1.52 1.37-2.624 1.677a6.48 6.48 0 0 0 5.17.794 6.5 6.5 0 0 0 1.807-.792" clipRule="evenodd" /></svg>
	);
};

export { IconMergedContinuous as ReactComponent };
