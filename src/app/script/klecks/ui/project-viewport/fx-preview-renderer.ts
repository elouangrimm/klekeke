import {TFxCanvas, TWrappedTexture} from '../../../fx-canvas/fx-canvas-types';
import {TProjectViewportLayerFunc, TViewportTransformXY} from './project-viewport';
import {BB} from '../../../bb/bb';
import {getSharedFx} from '../../../fx-canvas/shared-fx';
import {throwIfNull} from '../../../bb/base/base';
import {IRect} from '../../../bb/bb-types';
import {compose, translate, applyToPoint, inverse, scale} from 'transformation-matrix';
import {createTransformMatrix} from './utils/create-transform-matrix';

export type TFxPreviewRendererParams = {
    original: Exclude<CanvasImageSource, VideoFrame | HTMLOrSVGImageElement> | HTMLImageElement;
    onUpdate: (fxCanvas: TFxCanvas, transform: TViewportTransformXY) => TFxCanvas;
};

export class FxPreviewRenderer {
    private readonly original: TFxPreviewRendererParams['original'];
    private readonly onUpdate: TFxPreviewRendererParams['onUpdate'];
    private texture: TWrappedTexture | undefined = undefined;
    private readonly textureSource: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private isUpdated: boolean = true;
    private oldOnUpdateProps = {
        textureWidth: 0,
        textureHeight: 0,
        transform: {
            scaleX: 0,
            scaleY: 0,
            angleDeg: 0,
            x: 0,
            y: 0,
        },
    };
    private fxCanvas: TFxCanvas;


    // --- public ---
    constructor (p: TFxPreviewRendererParams) {
        this.original = p.original;
        this.onUpdate = p.onUpdate;
        this.textureSource = BB.canvas(1,1);
        this.ctx = BB.ctx(this.textureSource);
        this.fxCanvas = throwIfNull(getSharedFx());
    }

    render: TProjectViewportLayerFunc = (viewportTransform, viewportWidth, viewportHeight) => {
        const viewportMat = createTransformMatrix(viewportTransform);
        const padding = 0; // render more than visible with padding < 0

        let clippedViewportRect: IRect; // rect in viewport coordinates which contains the canvas
        {
            const topLeft = applyToPoint(viewportMat, {x: 0, y: 0});
            const bottomRight = applyToPoint(viewportMat, {x: this.original.width, y: this.original.height});
            bottomRight.x = Math.round(bottomRight.x);
            bottomRight.y = Math.round(bottomRight.y);
            const clippedTL = {
                x: Math.max(padding, topLeft.x),
                y: Math.max(padding, topLeft.y),
            };
            const clippedBR = {
                x: Math.min(viewportWidth - padding, (bottomRight.x)),
                y: Math.min(viewportHeight - padding, (bottomRight.y)),
            };
            clippedViewportRect = {
                x: clippedTL.x,
                y: clippedTL.y,
                width: clippedBR.x - clippedTL.x,
                height: clippedBR.y - clippedTL.y,
            };

            if (clippedViewportRect.width <= 0 || clippedViewportRect.height <= 0) {
                this.textureSource.width = 1;
                this.textureSource.height = 1;
                return this.textureSource;
            }
        }

        let resultTransform = compose(
            inverse(viewportMat),
            translate(padding, padding),
            translate(clippedViewportRect.x - padding, clippedViewportRect.y - padding),
        );

        const onUpdateProps = {
            textureWidth: Math.ceil(clippedViewportRect.width),
            textureHeight: Math.ceil(clippedViewportRect.height),
            transform: {
                scaleX: viewportTransform.scaleX,
                scaleY: viewportTransform.scaleY,
                angleDeg: viewportTransform.angleDeg,
                x: viewportTransform.x - clippedViewportRect.x,
                y: viewportTransform.y - clippedViewportRect.y,
            },
        };

        let tlOffsetX = 0;
        let tlOffsetY = 0;


        if (viewportTransform.scaleX > 1) {
            // what pixels of original canvas are actually visible
            const canvasTopLeft = applyToPoint(resultTransform, {x: 0, y: 0});
            tlOffsetX = -canvasTopLeft.x;
            tlOffsetY = -canvasTopLeft.y;
            canvasTopLeft.x = Math.max(0, Math.floor(canvasTopLeft.x));
            canvasTopLeft.y = Math.max(0, Math.floor(canvasTopLeft.y));
            tlOffsetX += canvasTopLeft.x;
            tlOffsetY += canvasTopLeft.y;

            const canvasBottomRight = applyToPoint(resultTransform, {x: clippedViewportRect.width, y: clippedViewportRect.height});
            canvasBottomRight.x = Math.min(this.original.width, Math.ceil(canvasBottomRight.x));
            canvasBottomRight.y = Math.min(this.original.height, Math.ceil(canvasBottomRight.y));


            const cw = canvasBottomRight.x - canvasTopLeft.x;
            const ch = canvasBottomRight.y - canvasTopLeft.y;

            onUpdateProps.textureWidth = cw;
            onUpdateProps.textureHeight = ch;
            onUpdateProps.transform = {
                scaleX: 1,
                scaleY: 1,
                angleDeg: 0,
                x: -canvasTopLeft.x,
                y: -canvasTopLeft.y,
            };

            resultTransform = compose(
                resultTransform,
                scale(viewportTransform.scaleX, viewportTransform.scaleY),
                translate(tlOffsetX, tlOffsetY),
            );
        }


        /*if (!this.isUpdated && JSON.stringify(newRender) === JSON.stringify(this.lastRender)) {
            return {
                image: this.fxCanvas,
                transform: outTransform,
            };
        }*/


        if (!this.texture || JSON.stringify(onUpdateProps) !== JSON.stringify(this.oldOnUpdateProps)) {
            // update texture
            this.textureSource.width = onUpdateProps.textureWidth;
            this.textureSource.height = onUpdateProps.textureHeight;

            // draw original canvas into temp
            this.ctx.save();
            this.ctx.imageSmoothingEnabled = false;
            if (viewportTransform.scaleX > 1) {
                this.ctx.setTransform(createTransformMatrix(onUpdateProps.transform));
            } else {
                this.ctx.setTransform(inverse(resultTransform));
            }
            this.ctx.drawImage(this.original, 0, 0);
            this.ctx.restore();
            // debug
            /*BB.css(this.canvas, {
                position: 'absolute',
                left: '0',
                top: '0',
                zIndex: '1000',
                boxShadow: '0 0 0 1px #f00',
            });
            document.body.append(this.canvas);*/

            this.texture && this.texture.destroy();
            this.texture = this.fxCanvas.texture(this.textureSource);

            this.textureSource.width = 1;
            this.textureSource.height = 1;
        }
        this.isUpdated = false;
        this.oldOnUpdateProps = onUpdateProps;

        const resultImage = this.onUpdate(
            this.fxCanvas.draw(this.texture),
            onUpdateProps.transform
        ).update();

        return {
            image: resultImage,
            transform: resultTransform,
        };
    };

    update (): void {
        this.isUpdated = true;
    }

    destroy (): void {
        BB.freeCanvas(this.textureSource);
        if (this.texture) {
            this.texture = this.fxCanvas.texture(this.textureSource);
            this.fxCanvas.draw(this.texture).update();
            this.texture && this.texture.destroy();
        }
    }
}


