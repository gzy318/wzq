import React from 'react';
import { Stage, Layer, Circle, Line, Text, Group, Rect } from 'react-konva';
import { KonvaEventObject } from 'konva/types/Node';
import update from 'immutability-helper';
import AgoraRTM, { RtmChannel, RtmMessage, RtmTextMessage } from 'agora-rtm-sdk';
import shortId from 'short-uuid';
import {agoraAppId} from '../env'
import './App.scss'

// 初始化声网接口
let agoraClient = AgoraRTM.createInstance(agoraAppId);
let agoraChannel: RtmChannel;
// 查询或创建用户ID
let userId = window.localStorage.getItem('agoraUserId') || ''
if (!userId) {
  userId = shortId.generate()
  window.localStorage.setItem('agoraUserId', userId)
}
// 从url获取频道ID, 如果没有获取到，就新建一个
const hash = window.location.hash;
let channelId = '';
if (hash && hash.slice(9)) {
  channelId = hash.slice(9)
} else {
  channelId = shortId.generate()
  window.location.hash = `#channel=${channelId}`
}

// 一些棋盘样式相关变量
const gridsColor = '#000'; // 线的颜色
const boardColor = '#F5C45A'; // 棋盘的颜色
const chessProps = { // 棋子的样式
  radius: 16,
  shadowColor: '#A9780A',
  shadowBlur: 4,
  shadowOffset: { x: 0, y: 4 },
  shadowOpacity: 1,
  fillRadialGradientStartPoint: { x: 0, y: -16 },
  fillRadialGradientStartRadius: 0,
  fillRadialGradientEndPoint: { x: 0, y: -16 },
  fillRadialGradientEndRadius: 14,
}

type Chess = {
  step: number,
  inFinishedLine: false, // 如果结束，连城线的棋子要
}

type Position = {
  x: number,
  y: number,
}

type State = {
  chesses: (Chess | null)[][], // 棋子
  steps: Position[], // 下过的步
  isFinished: boolean, // 是否结束
  showStep: boolean, // 显示
  scale: number, // 根据宽高设置放大倍数
  handType: number, // 执白0， 执黑1， 未定2
  opponent: boolean, // 是否有对手
  put: Position | null, // 落子位置
}

class App extends React.PureComponent {

  state: State;

  // 以下几项为了暂存state里的同步状态
  handType: number = 2; // 白0， 黑1， 未定2
  opponent: boolean = false; // 组队是否成功
  put: Position | null = null; // 落子位置

  constructor(props: any) {
    super(props)
    this.state = this.initState()
  }

  componentDidMount() {
    this.listenResize() // 监听视图尺寸变化
    this.listenRTM() // 监听点对点消息
  }

  initState = (): State => ({
    chesses: this.makeEmptyChesses(),
    steps: [],
    isFinished: false,
    showStep: true,
    scale: this.getScale(),
    handType: 2,
    opponent: false,
    put: null,
  })


  // 创建15*15的空数组，用来放棋子
  makeEmptyChesses = () => {
    const grids = [];
    for (let x = 0; x < 15; x++) {
      let yArr = []
      for (let y = 0; y < 15; y++) {
        yArr.push(null)
      }
      grids.push(yArr)
    }
    return grids
  }

  // 根据视图尺寸计算合适的缩放比例
  getScale = () => {
    return Math.min((window.innerWidth - 40) / 600, (window.innerHeight - 80) / 964)
  }

  // 监听视图尺寸变化
  listenResize = () => {
    window.addEventListener('resize', () => {
      this.setState({ scale: this.getScale() })
    })
  }

  // 监听点对点消息
  listenRTM = () => {
    // 登录声网
    agoraClient.login({ uid: userId }).then(() => {
      agoraChannel = agoraClient.createChannel(channelId)
      // 对手加入
      agoraChannel.on('MemberJoined', () => {
        this.opponent = true;
        this.setState({ opponent: true });
        agoraChannel.sendMessage({
          text: JSON.stringify({
            title: 'handleJoinChannel',
            data: {
              state: {
                chesses: this.state.chesses,
                steps: this.state.steps,
                isFinished: this.state.isFinished,
              },
              handType: this.handType === 2 ? 2 : Number(!this.handType)
            }
          })
        })
      })
      // 对手离开，这个一般会延时30多才通知
      agoraChannel.on('MemberLeft', () => {
        this.opponent = false;
        this.setState({ opponent: false });
      })
      // 对手发消息
      agoraChannel.on('ChannelMessage', (message: RtmMessage, memberId: string) => {
        if (memberId !== userId && (message as RtmTextMessage).text) {
          try {
            const { title, data }: { title: string, data: any } = JSON.parse((message as RtmTextMessage).text);
            switch (title) {
              case 'handleOtherPutChessOk': // 对手落子
                this.handleOtherPutChessOk(data)
                break
              case 'handleRestartGame': // 对手重开一局
                this.handleRestartGame()
                break
              case 'handleJoinChannel': // 已方加入，对手把当前局面信息发过来，这里是防止自己意外掉线
                this.handleJoinChannel(data)
                break
              default:
            }
          } catch (e) {

          }
        }
      })
      agoraChannel.join();
    })
  }

  handleJoinChannel = (options: any) => {
    this.handType = options.handType
    this.opponent = true
    this.setState({ ...options.state, handType: this.handType, opponent: true })
  }

  // 落子
  handleChessDown = ({ x, y }: Position) => {
    if (this.state.chesses[x]?.[y] === null) {
      const newState = update(this.state, {
        chesses: {
          [x]: {
            [y]: {
              $set: {
                step: this.state.steps.length + 1,
                inFinishedLine: false,
              }
            }
          }
        },
        steps: { $push: [{ x, y }] },
        handType: { $set: this.handType },
        put: { $set: this.put },
      })

      this.setState(newState, () => {
        const lineChesses = this.checkIsFinished({ x, y })
        if (lineChesses.length > 0) {
          const chesses = JSON.parse(JSON.stringify(this.state.chesses));
          lineChesses.forEach(({ x, y }) => chesses[x][y].inFinishedLine = true)
          this.setState({ chesses, isFinished: true })
        }
      })
    }
  }

  // 对面落子
  handleOtherPutChessOk = (position: Position) => {
    // 棋盘为空，对面落子，己方执白
    if (this.state.steps.length === 0) {
      this.handType = 0
      this.put = null
    }
    this.handleChessDown(position)
  }

  // 自己落子
  onClickBoard = (e: KonvaEventObject<any>) => {
    // 棋盘非空，（已下步数为奇数且执黑）或（已下步数为偶数且执白）时不能落子
    if (this.state.steps.length > 0 && this.handType === (this.state.steps.length) % 2) {
      console.log("该别人下了")
      return
    }
    // 结束了就不要再下了
    if (this.state.isFinished) {
      console.log("已经结束了")
      return
    }

    // 棋盘为空，己方落子，己方执黑
    if (this.state.steps.length === 0) {
      this.handType = 1
    }

    const pos = e.target.getStage()?.getPointerPosition()
    if (pos) {
      const x = Math.floor(pos.x / 40)
      const y = Math.floor(pos.y / 40)
      // 不能落在已有的棋子上
      if(this.state.steps.findIndex(item => item.x === x && item.y === y) !== -1) {
        return
      }
      this.put = { x, y }
      this.setState({ put: { x, y } })
    }
  }


  // 判断是否结束
  checkIsFinished = ({ x: xi, y: yi }: Position) => {
    const isBlack = this.state.steps.length % 2
    const lines: { x: number, y: number }[][] = [[], [], [], []];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) {
          continue
        }
        let x = xi + dx;
        let y = yi + dy;
        let chess = this.state.chesses[x][y];
        while (chess && chess.step && chess.step % 2 === isBlack) {
          let dir = Math.abs((dx + 1) * 3 + dy - 3) - 1; // 方向
          lines[dir].push({ x, y });
          if (lines[dir].length === 4) {
            return lines[dir]
          }
          x += dx;
          y += dy;
          chess = this.state.chesses[x]?.[y]
        }
      }
    }
    return []
  }

  // 点击重开，执行重开并通知对手重开
  onClickRestart = () => {
    this.handleRestartGame()
    agoraChannel.sendMessage({
      text: JSON.stringify({
        title: 'handleRestartGame',
      })
    })
  }

  // 执行重开操作
  handleRestartGame = () => {
    this.handType = 2;
    this.setState({ ...this.initState(), opponent: this.opponent })
  }

  // 点击确定，发送最后一步
  onClickOk = () => {
    // 如果对面不在，无法确定
    if (this.state.put) {
      agoraChannel.sendMessage({
        text: JSON.stringify({
          title: 'handleOtherPutChessOk',
          data: this.state.put,
        }),
      });
      this.put = null
      this.handleChessDown(this.state.put)
    }
  }

  genNewRoom = () => {
    const url = window.location.href.split('#')[0] + '#channel=' + shortId.generate()
    navigator.clipboard.writeText(url)
    setTimeout(() => {
      const res = confirm("新房间链接已复制，是否跳转到新房间？")
      if (res) {
        window.location.href = url
        window.location.reload()
      }
    }, 500)

  }

  copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setTimeout(() => {
      alert('房间链接已复制，发给朋友邀请他加入游戏')
    }, 500)
  }

  render() {
    let opponentDesc = ''
    if (!this.state.opponent) {
      if (this.state.handType === 2) {
        opponentDesc = '👀 无对手，请分享本页邀请朋友'
      } else {
        opponentDesc = '👀 对手下线'
      }
    }

    let boardDesc = '';
    if (this.state.handType === 2) {
      boardDesc = "抢先"
    } else if (this.state.isFinished) {
      boardDesc = this.state.steps.length % 2 === this.handType ? '你赢了😺' : '你输了🙈'
    } else if (this.state.steps.length % 2 !== this.handType) {
      boardDesc = '该你了⏱'
    }
    return <div className="App">
      <div className="game" style={{ transform: `scale(${this.state.scale})` }}>
        {/* 房间ID及复制按钮 */}
        <div className="roomLink">
          房间ID：{window.location.hash.slice(9)}
          <button
            className="btn yellow"
            style={{ marginLeft: 10 }}
            onClick={this.copyLink}
          >邀请</button></div>
        {/* 一些操作按钮 */}
        <div className="actions">
          {/* 执白执黑 */}
          <div className="handType">{['⚪️', '⚫️', '❔'][this.state.handType]}</div>
          <button
            className="btn yellow"
            style={{ marginLeft: 20 }}
            onClick={this.onClickRestart}
          >重开</button>
          <div className="desc">{boardDesc}</div>
          <button
            className="btn green"
            style={{ marginLeft: 'auto' }}
            onClick={this.onClickOk}
            disabled={!this.state.put || !this.state.opponent} // 没有落子或无对手时，按钮禁用
          >确定</button>
        </div>
        <div className="board">
          <Stage width={600} height={600} onMouseDown={this.onClickBoard} onTouchStart={this.onClickBoard}>
            <Layer>
              {/* 棋盘背景 */}
              <Rect width={600} height={600} fill={boardColor}></Rect>
              {/* 棋盘线 */}
              {[...Array(15)].map((_, i) => <Line
                key={`row_${i}`}
                points={[0, 40 * i, 560, 40 * i]}
                stroke={gridsColor}
                strokeWidth={1}
                closed
                x={20}
                y={20}
              ></Line>)}
              {[...Array(15)].map((_, i) => <Line
                key={`col_${i}`}
                points={[40 * i, 0, 40 * i, 560]}
                stroke={gridsColor}
                strokeWidth={1}
                closed
                x={20}
                y={20}
              ></Line>)}
              {/* 棋盘圆点 */}
              <Circle x={300} y={300} radius={6} fill={gridsColor}></Circle>
              <Circle x={140} y={140} radius={6} fill={gridsColor}></Circle>
              <Circle x={460} y={140} radius={6} fill={gridsColor}></Circle>
              <Circle x={140} y={460} radius={6} fill={gridsColor}></Circle>
              <Circle x={460} y={460} radius={6} fill={gridsColor}></Circle>
            </Layer>
            <Layer opacity={0.9}>
              {/* 棋子 */}
              {this.state.chesses.map((xItem: (Chess | null)[], xi: number) => <Group key={`x_${xi}`}>
                {xItem.map((item, yi) => item ? (<Group key={`y_${yi}`}>
                  <Circle
                    key={`chess_${yi}`}
                    x={xi * 40 + 20}
                    y={yi * 40 + 20}
                    fillRadialGradientColorStops={item.step % 2 ? [0, '#666', 1, '#000'] : [0, '#fff', 1, '#ccc']}
                    stroke={item.step % 2 ? '#9AFF82' : '#00FFFB'}
                    strokeWidth={item.step === this.state.steps.length || item.inFinishedLine ? 2 : 0}
                    {...chessProps}
                  ></Circle>
                  {this.state.showStep ? (<Text
                    key={`step_${yi}`}
                    width={28}
                    height={28}
                    x={xi * 40 + 20 - 14}
                    y={yi * 40 + 20 - 6}
                    fill={item.step % 2 ? '#ffffff' : '#000000'}
                    text={`${item.step}`}
                    fontSize={13}
                    align={'center'}
                  ></Text>) : null}
                </Group>) : null)}
              </Group>)}
              {/* 落子 */}
              {this.state.put ? <Circle
                x={this.state.put.x * 40 + 20}
                y={this.state.put.y * 40 + 20}
                fillRadialGradientColorStops={this.state.handType ? [0, '#666', 1, '#000'] : [0, '#fff', 1, '#ccc']}
                {...chessProps}
              ></Circle> : null}
            </Layer>
          </Stage>
        </div>
        {/* 是否有对手的信息提示 */}
        <div className="opponent">{opponentDesc}</div>
        <button className="btn yellow" style={{ marginTop: 30 }} onClick={this.genNewRoom}>生成新房间并复制链接</button>
      </div>
    </div>
  }
}


export default App
