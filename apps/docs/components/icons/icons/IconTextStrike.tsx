// Generated from svgs/IconTextStrike.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconTextStrike = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8.042 15q-1.47 0-2.568-.474-1.088-.473-1.73-1.308a3.75 3.75 0 0 1-.735-1.939L3 11.177h1.674l.01.102q.065.669.511 1.16.456.483 1.21.751.762.27 1.73.27.912 0 1.618-.288.717-.297 1.126-.807a1.88 1.88 0 0 0 .41-1.197v-.01q0-.212-.04-.408h1.747q.004.097.004.195v.01q0 1.242-.614 2.152t-1.73 1.4Q9.54 15 8.042 15M11.246 8H15v1.5H1V8h4.472q-.756-.348-1.226-.821-.91-.928-.911-2.394v-.01q.01-1.103.605-1.957.604-.853 1.665-1.336Q6.675 1 8.06 1q1.34 0 2.372.482 1.034.474 1.638 1.28a3.3 3.3 0 0 1 .679 1.82l.01.129h-1.675l-.019-.12a2.1 2.1 0 0 0-.484-1.058A2.66 2.66 0 0 0 9.54 2.8q-.652-.27-1.526-.26-.846 0-1.516.26t-1.06.751q-.391.483-.391 1.178v.01q0 .808.595 1.354.595.538 1.963.835l1.488.334q1.318.288 2.153.738" /></svg>
	);
};

export { IconTextStrike as ReactComponent };
