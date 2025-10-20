// Generated from svgs/IconMagnifyingGlassFocus.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconMagnifyingGlassFocus = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M6.994.751a.75.75 0 0 1-.702.795c-1.932.12-2.991.486-3.626 1.121-.635.636-1 1.697-1.12 3.63A.75.75 0 0 1 .05 6.204c.125-2.01.513-3.554 1.556-4.597C2.647.564 4.189.174 6.199.049a.75.75 0 0 1 .795.702m2.012 0A.75.75 0 0 1 9.8.05c2.01.125 3.552.515 4.594 1.558s1.431 2.586 1.556 4.597a.75.75 0 0 1-1.497.093c-.12-1.933-.485-2.994-1.12-3.63s-1.694-1-3.626-1.12A.75.75 0 0 1 9.006.75M.75 8.997a.75.75 0 0 1 .795.703c.12 1.935.484 2.996 1.12 3.632.634.636 1.694 1.001 3.626 1.122A.75.75 0 1 1 6.2 15.95c-2.01-.125-3.553-.515-4.595-1.559C.56 13.348.174 11.804.049 9.792a.75.75 0 0 1 .702-.795M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4 8a4 4 0 1 1 8 0 4 4 0 0 1-8 0" clipRule="evenodd" /><path fillRule="evenodd" d="m10.707 9.293 3 3a1 1 0 0 1-1.414 1.414l-3-3z" clipRule="evenodd" /></svg>
	);
};

export { IconMagnifyingGlassFocus as ReactComponent };
