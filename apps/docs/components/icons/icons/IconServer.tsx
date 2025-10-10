// Generated from svgs/IconServer.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconServer = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M1.533 1.526C.937 2.12.553 2.925.317 4 .087 5.054 0 6.368 0 8c0 6.588 1.412 8 8 8s8-1.412 8-8-1.412-8-8-8C4.709 0 2.71.352 1.533 1.526M1.86 4c.19-.7.443-1.124.73-1.41.324-.324.825-.606 1.705-.802C5.194 1.588 6.387 1.5 8 1.5s2.806.088 3.704.288c.88.196 1.381.478 1.706.802.286.286.54.71.73 1.41-.19.7-.444 1.124-.73 1.41-.325.324-.826.606-1.706.802-.898.2-2.091.288-3.704.288s-2.806-.088-3.704-.288c-.88-.196-1.381-.478-1.706-.802-.286-.286-.54-.71-.73-1.41m-.328 2.474.026.026-.029.029q0-.028.003-.055m.074.072q.067.648.18 1.158c.197.88.479 1.381.803 1.706s.826.607 1.706.802c.898.2 2.091.288 3.704.288s2.806-.088 3.704-.288c.88-.195 1.381-.478 1.706-.802s.607-.826.802-1.706q.114-.51.18-1.158C13.208 7.662 11.223 8 8 8s-5.206-.338-6.393-1.454M14.441 6.5l.029.029q0-.028-.003-.055zM8 12c3.222 0 5.207-.338 6.393-1.454q-.068.648-.18 1.158c-.196.88-.479 1.381-.803 1.706s-.826.607-1.706.802c-.898.2-2.091.288-3.704.288s-2.806-.088-3.704-.288c-.88-.195-1.381-.478-1.706-.802s-.606-.826-.802-1.706a10 10 0 0 1-.18-1.158C2.793 11.662 4.777 12 8 12" clipRule="evenodd" /></svg>
	);
};

export { IconServer as ReactComponent };
