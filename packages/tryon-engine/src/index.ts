/**
 * @cda/tryon-engine
 *
 * 3D 试穿引擎。设计目标：**一份代码跑 H5 / App / 微信小程序**。
 *
 * 使用方式：
 *   const engine = new TryonEngine({ platform: createH5Platform(), canvas, width, height })
 *   engine.setBodyProfile(profile)
 *   engine.addGarment('p_white_shirt')
 *   engine.setWearMode('p_white_shirt', 'open')
 *   engine.setFastenerClosed('p_white_shirt', 2)
 *   engine.start()
 */
export * from './platform'
export * from './body'
export * from './garment'
export * from './engine'
