// Generated from svgs/IconBell.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBell = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M3.5 6c0-1.46.452-2.567 1.193-3.307C5.433 1.952 6.54 1.5 8 1.5c1.46 0 2.567.452 3.308 1.193.74.74 1.192 1.848 1.192 3.307v3.624c0 .287.025.658.181 1.025.216.506.572.991.858 1.38q.118.16.213.295c.147.21.26.393.342.56a31 31 0 0 1-.999.12A49 49 0 0 1 8 13.25c-2.203 0-3.927-.123-5.095-.246a31 31 0 0 1-1-.12c.082-.167.196-.35.343-.56q.095-.136.213-.294c.286-.39.642-.875.858-1.38.156-.368.181-.739.181-1.026zm11.645 8.236L15 13.5za.75.75 0 0 0 .605-.725c.012-.848-.407-1.531-.77-2.047q-.162-.23-.304-.424c-.263-.36-.474-.647-.614-.978-.04-.093-.062-.226-.062-.438V6c0-1.775-.556-3.292-1.632-4.368S9.775 0 8 0C6.226 0 4.708.556 3.632 1.632S2 4.225 2 6v3.624c0 .212-.022.345-.062.438-.14.33-.351.619-.614.978q-.143.194-.305.424c-.362.516-.781 1.2-.769 2.047a.75.75 0 0 0 .605.725L1 13.5l-.145.736h.004l.007.002.026.005a11 11 0 0 0 .461.077c.32.048.788.112 1.396.176.858.09 1.996.18 3.385.224a2 2 0 0 0 3.732 0 47 47 0 0 0 3.386-.224 31 31 0 0 0 1.76-.236l.096-.017.026-.005.007-.001z" /></svg>
	);
};

export { IconBell as ReactComponent };
