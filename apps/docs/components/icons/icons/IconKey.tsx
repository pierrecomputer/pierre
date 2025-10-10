// Generated from svgs/IconKey.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconKey = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M3.5 7.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2" /><path fillRule="evenodd" d="M4.5 4c1.56 0 2.933.796 3.74 2h6.01l.085.005a.75.75 0 0 1 .5.276l1 1.25a.75.75 0 0 1 .05.866l-1.25 2a.75.75 0 0 1-.97.274l-1.061-.531-1.123.936a.75.75 0 0 1-.961 0L9.229 10h-.486A4.5 4.5 0 1 1 4.5 4m0 1.5a3 3 0 1 0 2.94 3.6l.038-.125a.75.75 0 0 1 .697-.475H9.5a.75.75 0 0 1 .48.174l1.02.85 1.02-.85.09-.065a.75.75 0 0 1 .725-.03l.89.445.607-.97-.443-.554H7.817a.75.75 0 0 1-.663-.4A3 3 0 0 0 4.5 5.5" clipRule="evenodd" /></svg>
	);
};

export { IconKey as ReactComponent };
